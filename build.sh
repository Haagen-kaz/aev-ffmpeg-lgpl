#!/usr/bin/env bash
# AEV（omniview）に同梱する ffmpeg.exe を、LGPL（2.1 以降）の最小構成で ubuntu の mingw-w64 からクロスビルドする。
# - ソースは tag の commit SHA で固定（clone 後に rev-parse で照合。合わなければ止まる）。
# - 外部ライブラリは libopenh264（BSD-2-Clause・同じジョブでソースからビルド）と Windows の Media Foundation（h264_mf）だけ。
#   h264_mf は 9.0 から D3D11 を使うので d3d11va も有効にする（Windows の API。外部ライブラリではない）。
# - 入力は AEV が変換を勧める形＝ HEVC（生ストリーム・MOV/MP4・MPEG-TS・FLV）と ProRes（MOV・MKV）。
#   容器の音声（AAC・MP3・MP2・AC-3・FLAC・Opus・Vorbis・PCM など）も読めないと変換全体が失敗する。
# - 出力は H.264（libopenh264 / h264_mf）＋ AAC の MP4。
# - configure の「License: LGPL version 2.1 or later」・外部ライブラリの一覧・exe の文字列を確かめ、違えば止まる。
# 出力（$OUT）: <NAME>.zip（<NAME>/bin/ffmpeg.exe と LICENSE）・対応ソースの tar 2 つ・build.sh・configure.txt・
#   static-runtime.txt（読み込む DLL と、静的に入った mingw-w64・GCC の実行時部品）・SHA256SUMS・NAME
# 構成を変えたら BUILD_REV を 1 つ上げる（同じ名前の Release は作り直さない。CI が build.sh の違いで止める）。
set -euo pipefail
SELF=$(readlink -f "$0") # 下で cd するので先に絶対パスにしておく

BUILD_REV=2
FFMPEG_VERSION=9.0.2
FFMPEG_COMMIT=946fcce07b6dcd0331c8cc609192aeff5e1924f8   # FFmpeg n9.0.2
OPENH264_VERSION=2.6.0
OPENH264_COMMIT=652bdb7719f30b52b08e506645a7322ff1b2cc6f # cisco/openh264 v2.6.0
NAME=ffmpeg-lgpl-${FFMPEG_VERSION}-r${BUILD_REV}
CROSS=x86_64-w64-mingw32-

WORK=${WORK:-$PWD/ffbuild}
OUT=${OUT:-$PWD/ffout}
PREFIX=$WORK/prefix
mkdir -p "$WORK" "$OUT" "$PREFIX"

# url tag commit dir: tag を浅く clone し、commit が固定値と同じか確かめる
fetch() {
  git clone --quiet --depth 1 --branch "$2" "$1" "$4"
  local got
  got=$(git -C "$4" rev-parse HEAD)
  [ "$got" = "$3" ] || { echo "commit mismatch for $1 $2: $got (expected $3)" >&2; exit 1; }
}
fetch https://github.com/FFmpeg/FFmpeg.git "n$FFMPEG_VERSION" "$FFMPEG_COMMIT" "$WORK/ffmpeg"
fetch https://github.com/cisco/openh264.git "v$OPENH264_VERSION" "$OPENH264_COMMIT" "$WORK/openh264"

# 対応ソース（LGPL の申し出に使う）。同じ Release に置く
git -C "$WORK/ffmpeg" archive --format=tar --prefix="ffmpeg-$FFMPEG_VERSION/" HEAD | xz -9 > "$OUT/ffmpeg-$FFMPEG_VERSION-src.tar.xz"
git -C "$WORK/openh264" archive --format=tar.gz --prefix="openh264-$OPENH264_VERSION/" HEAD > "$OUT/openh264-$OPENH264_VERSION-src.tar.gz"

make -C "$WORK/openh264" -j"$(nproc)" OS=mingw_nt ARCH=x86_64 BUILDTYPE=Release \
  CC="${CROSS}gcc" CXX="${CROSS}g++" AR="${CROSS}ar" PREFIX="$PREFIX" install-static

cd "$WORK/ffmpeg"
PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" ./configure \
  --prefix="$PREFIX" --arch=x86_64 --target-os=mingw32 --cross-prefix="$CROSS" \
  --pkg-config=pkg-config --pkg-config-flags=--static --extra-ldflags=-static \
  --disable-autodetect --disable-everything --disable-doc --disable-debug --disable-network \
  --disable-ffplay --disable-ffprobe --disable-avdevice \
  --enable-w32threads --enable-mediafoundation --enable-d3d11va --enable-libopenh264 \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,hevc,mpegts,flv,matroska \
  --enable-decoder=hevc,prores,aac,aac_latm,mp3float,mp2float,alac,ac3,eac3,flac,opus,vorbis,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be \
  --enable-parser=hevc,aac,aac_latm,mpegaudio,ac3,flac,opus,vorbis \
  --enable-encoder=libopenh264,h264_mf,aac \
  --enable-muxer=mp4 \
  --enable-filter=scale,format,aformat,aresample,null,anull \
  | tee "$OUT/configure.txt"

grep -qx 'License: LGPL version 2.1 or later' "$OUT/configure.txt" || { echo 'configure: license is not LGPL 2.1+' >&2; exit 1; }
# 「External libraries:」の次の行から空行までが外部ライブラリ。libopenh264 と Windows の Media Foundation だけであること
libs=$(awk '/^External libraries:$/{f=1;next} f&&/^$/{exit} f' "$OUT/configure.txt" | xargs)
[ "$libs" = "libopenh264 mediafoundation" ] || { echo "configure: unexpected external libraries: $libs" >&2; exit 1; }

make -j"$(nproc)" ffmpeg.exe
"${CROSS}strip" ffmpeg.exe
# GPL・nonfree の部品が入っていないこと。ライブラリ本体が埋め込む版の文字列（FFTW「fftw-3.x」・x264「x264 - core」・
# x265「HEVC encoder version」）と、configure の --enable-gpl / --enable-nonfree / GPL の外部ライブラリ。
# 「libx265」「x265-stats」などの名前だけは FFmpeg 自身（LGPL）の文字列にもあるので見ない。
strings -a ffmpeg.exe > "$WORK/strings.txt"
grep -q 'LGPL version 2.1 or later' "$WORK/strings.txt" || { echo 'ffmpeg.exe: no LGPL license string' >&2; exit 1; }
if grep -E 'fftw-[0-9]|x264 - core|HEVC encoder version|--enable-(gpl|nonfree|libx26[45]|chromaprint|frei0r|librubberband|libvidstab)' "$WORK/strings.txt"; then
  echo 'ffmpeg.exe: contains GPL / nonfree markers' >&2; exit 1
fi

# 静的リンク: mingw-w64・GCC の実行時 DLL（libstdc++-6・libwinpthread-1・libgcc_s）に頼らないこと。
# 静的に入った実行時部品は、記号つきの ffmpeg_g.exe の記号の数で書き出す（通知の要否の根拠。0 なら入っていない）。
"${CROSS}objdump" -p ffmpeg.exe | awk '/DLL Name:/{print $3}' | sort -u > "$WORK/dlls.txt"
if grep -iE 'libstdc\+\+|libwinpthread|libgcc_s' "$WORK/dlls.txt"; then echo 'ffmpeg.exe: depends on mingw runtime DLLs' >&2; exit 1; fi
"${CROSS}nm" ffmpeg_g.exe > "$WORK/nm.txt"
{
  echo '# DLLs imported by ffmpeg.exe (objdump -p)'
  cat "$WORK/dlls.txt"
  echo
  echo '# statically linked runtime: number of symbols in ffmpeg_g.exe (nm)'
  for p in 'libstdc++:_ZNSt|_ZSt|__cxa_|__gxx_' 'winpthreads:pthread_(create|mutex_lock|once|self)' \
           'libgcc:__udivti3|__divti3|__umodti3|___chkstk_ms|_Unwind_' 'mingw-w64 CRT:__mingw_'; do
    echo "${p%%:*}: $(grep -cE "${p#*:}" "$WORK/nm.txt" || true)"
  done
  echo
  echo '# toolchain'
  "${CROSS}gcc" --version | head -1
  dpkg-query -W -f='${Package} ${Version}
' mingw-w64-common mingw-w64-x86-64-dev gcc-mingw-w64-x86-64-win32 g++-mingw-w64-x86-64-win32 2>/dev/null || true
} > "$OUT/static-runtime.txt"
cat "$OUT/static-runtime.txt"

mkdir -p "$OUT/$NAME/bin"
cp ffmpeg.exe "$OUT/$NAME/bin/"
cp COPYING.LGPLv2.1 "$OUT/$NAME/LICENSE.txt"
cp "$WORK/openh264/LICENSE" "$OUT/$NAME/LICENSE.openh264.txt"
cp "$OUT/configure.txt" "$OUT/static-runtime.txt" "$OUT/$NAME/"
(cd "$OUT" && zip -qr "$NAME.zip" "$NAME" && rm -r "$NAME")
cp "$SELF" "$OUT/build.sh"
echo "$NAME" > "$OUT/NAME"
(cd "$OUT" && unzip -p "$NAME.zip" "$NAME/bin/ffmpeg.exe" | sha256sum | sed "s|-\$|$NAME/bin/ffmpeg.exe|" > SHA256SUMS && sha256sum -- *.zip *.tar.* build.sh configure.txt static-runtime.txt >> SHA256SUMS)
cat "$OUT/SHA256SUMS"

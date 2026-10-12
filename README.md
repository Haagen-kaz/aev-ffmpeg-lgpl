# aev-ffmpeg-lgpl

AEV（omniview）に同梱する ffmpeg の LGPL 最小構成ビルドと、その対応ソースを置く repo です。

## 置いてあるもの

- `build.sh` — ubuntu-24.04 の mingw-w64 で `ffmpeg.exe`（win64・静的リンク）をクロスビルドするスクリプト。
  - FFmpeg **n9.0.2**（commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`）と OpenH264 **v2.6.0**（commit `652bdb7719f30b52b08e506645a7322ff1b2cc6f`）を tag から取り、commit を照合します。
  - configure は `--disable-everything --disable-autodetect` から必要な分だけを有効にし、`--enable-gpl`・`--enable-nonfree`・`--enable-version3` を使いません（**LGPL 2.1 以降**）。外部ライブラリは libopenh264 だけ（ほかに Windows の Media Foundation）。
  - configure の `License:`・外部ライブラリの一覧・exe の文字列・読み込む DLL を確かめ、違えばビルドが止まります。
- `.github/workflows/build.yml` — `build.sh` を CI で動かし（zip に `LICENSES/` を `licenses/` として足し、`SHA256SUMS` の zip の値を直す）、main への push と main での手動実行のときだけ Release を作ります（PR ではビルドと検査だけ・書き込み権限は Release を作る job だけ）。
- `test/` — `build.sh` の構成・`build.yml` の分岐と権限・条文（`LICENSES/`）と zip への同梱の検査（`node --test`）。

## Release

タグ `ffmpeg-lgpl-<FFmpeg の版>-r<BUILD_REV>`（pre-release）ごとに次を置きます。

| ファイル | 中身 |
|---|---|
| `ffmpeg-lgpl-*.zip` | `bin/ffmpeg.exe`・`LICENSE.txt`（FFmpeg の LGPL 2.1）・`LICENSE.openh264.txt`・`configure.txt`・`static-runtime.txt`・`licenses/`（この repo の `LICENSES/` の全ファイル。下の「ライセンス」） |
| `ffmpeg-*-src.tar.xz` | FFmpeg の対応ソース（`git archive`） |
| `openh264-*-src.tar.gz` | OpenH264 の対応ソース（`git archive`） |
| `build.sh` | その版を作ったスクリプト |
| `configure.txt` | configure の出力 |
| `static-runtime.txt` | 読み込む DLL と、静的に入った mingw-w64・GCC の実行時部品 |
| `SHA256SUMS` | 上のファイルと `bin/ffmpeg.exe` の SHA256 |

## ライセンス

- FFmpeg: LGPL-2.1-or-later — [`LICENSES/FFmpeg-COPYING.LGPLv2.1`](LICENSES/FFmpeg-COPYING.LGPLv2.1)
- OpenH264: BSD-2-Clause — [`LICENSES/OpenH264-LICENSE`](LICENSES/OpenH264-LICENSE)
- exe に静的に入る実行時部品（`static-runtime.txt` の記号の数を参照）。ubuntu-24.04 の mingw-w64 11.0.1・GCC 13.2.0 の版のソースから写したもので、omniview の `docs/legal/licenses/ffmpeg-components/` の写しとバイトが同じです。

  | 部品 | ライセンス | 条文 | 写し元 |
  |---|---|---|---|
  | mingw-w64（CRT） | ZPL-2.1 ほか | [`LICENSES/mingw-w64-COPYING`](LICENSES/mingw-w64-COPYING) | https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/COPYING |
  | mingw-w64 の実行時部品 | MIT・BSD-3-Clause ほか | [`LICENSES/mingw-w64-COPYING.MinGW-w64-runtime.txt`](LICENSES/mingw-w64-COPYING.MinGW-w64-runtime.txt) | https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt |
  | mingw-w64 | ZPL-2.1 ほか | [`LICENSES/mingw-w64-COPYING.MinGW-w64.txt`](LICENSES/mingw-w64-COPYING.MinGW-w64.txt) | https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/COPYING.MinGW-w64/COPYING.MinGW-w64.txt |
  | winpthreads（mingw-w64） | MIT | [`LICENSES/mingw-w64-winpthreads-COPYING`](LICENSES/mingw-w64-winpthreads-COPYING) | https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/mingw-w64-libraries/winpthreads/COPYING |
  | GCC の実行時ライブラリ（libgcc・libstdc++） | GPL-3.0-or-later WITH GCC-exception-3.1 | [`LICENSES/GCC-COPYING.RUNTIME`](LICENSES/GCC-COPYING.RUNTIME)（GCC Runtime Library Exception 3.1。これにより exe には GPL の条件がかからない） | https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-13.2.0/COPYING.RUNTIME |

- `build.sh`・ワークフロー・テスト・この README は Haagen-kaz が作成したものです（FFmpeg・OpenH264 の一部ではありません）。

H.264 の特許（Via LA など）の扱いは、このビルドのライセンスとは別の話です。

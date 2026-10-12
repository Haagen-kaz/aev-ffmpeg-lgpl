// build.sh の構成の検査: configure が GPL・nonfree・version3 を使わず、外部ライブラリは libopenh264 だけで、
// 入力（HEVC・ProRes とその容器・音声）と出力（H.264＋AAC の MP4）に絞られていること。
// 実際の License: LGPL と exe の文字列は、build.sh 自身が CI のビルドで確かめる。
// 実行: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const build = readFileSync(new URL('../build.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const configure = /\.\/configure \\\n([\s\S]*?)\n\s*\| tee/.exec(build)[1];
const listOf = (kind) => (new RegExp(`--enable-${kind}=(\\S+)`).exec(configure)?.[1] ?? '').split(',');
const pinned = (key) => new RegExp(`^${key}=(\\S+)`, 'm').exec(build)?.[1];

test('configure は GPL・nonfree・version3 を有効にせず、--disable-everything と --disable-autodetect から始める', () => {
  assert.doesNotMatch(configure, /--enable-(gpl|nonfree|version3)\b/);
  assert.match(configure, /--disable-everything/);
  assert.match(configure, /--disable-autodetect/);
});

test('外部ライブラリは libopenh264 だけ（ほかに Windows の Media Foundation・D3D11 と w32threads）', () => {
  assert.deepEqual([...configure.matchAll(/--enable-(lib\w+)/g)].map((m) => m[1]), ['libopenh264']);
  assert.match(configure, /--enable-mediafoundation/);
  assert.match(configure, /--enable-d3d11va/); // 9.0 の h264_mf（mfenc.c）は D3D11 の型を使う
});

test('エンコーダは H.264（libopenh264・h264_mf）と AAC、出力は mp4 だけ', () => {
  assert.deepEqual(listOf('encoder').sort(), ['aac', 'h264_mf', 'libopenh264']);
  assert.deepEqual(listOf('muxer'), ['mp4']);
});

test('入力の容器（MOV/MP4・生 HEVC・MPEG-TS・FLV・MKV）と映像・音声のデコーダ', () => {
  for (const d of ['mov', 'hevc', 'mpegts', 'flv', 'matroska']) assert.ok(listOf('demuxer').includes(d), `demuxer ${d}`);
  for (const d of ['hevc', 'prores', 'aac', 'mp2float', 'flac', 'opus', 'vorbis', 'pcm_s32be', 'pcm_f64le', 'pcm_f64be']) assert.ok(listOf('decoder').includes(d), `decoder ${d}`);
  for (const f of ['scale', 'format', 'aformat', 'aresample']) assert.ok(listOf('filter').includes(f), `filter ${f}`);
});

test('ソースは版と commit（40 桁）で固定し、clone 後に照合する', () => {
  assert.match(pinned('FFMPEG_VERSION') ?? '', /^\d+\.\d+(\.\d+)?$/);
  assert.match(pinned('OPENH264_VERSION') ?? '', /^\d+\.\d+\.\d+$/);
  assert.match(pinned('FFMPEG_COMMIT') ?? '', /^[0-9a-f]{40}$/);
  assert.match(pinned('OPENH264_COMMIT') ?? '', /^[0-9a-f]{40}$/);
  assert.match(pinned('BUILD_REV') ?? '', /^\d+$/);
  assert.match(build, /rev-parse HEAD/);
  assert.match(build, /^set -euo pipefail$/m);
});

test('ビルドは License: LGPL・外部ライブラリ・exe の GPL の印・mingw の実行時 DLL を確かめ、違えば止まる', () => {
  assert.match(build, /grep -qx 'License: LGPL version 2\.1 or later'/);
  assert.match(build, /\[ "\$libs" = "libopenh264 mediafoundation" \]/);
  assert.match(build, /fftw-\[0-9\]\|x264 - core\|HEVC encoder version\|--enable-\(gpl\|nonfree\|libx26\[45\]\|chromaprint/);
  assert.ok(build.includes("grep -iE 'libstdc\\+\\+|libwinpthread|libgcc_s'"), 'mingw の実行時 DLL の検査が無い');
  assert.match(build, /static-runtime\.txt/);
});

test('対応ソースの tar を作り、Release に置くものに含める', () => {
  assert.match(build, /archive --format=tar --prefix="ffmpeg-\$FFMPEG_VERSION\/"/);
  assert.match(build, /archive --format=tar\.gz --prefix="openh264-\$OPENH264_VERSION\/"/);
  const wf = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
  assert.match(wf, /"\$OUT"\/\*-src\.tar\.\* "\$OUT\/build\.sh"/);
  assert.doesNotMatch(wf, /upload-artifact/);
});

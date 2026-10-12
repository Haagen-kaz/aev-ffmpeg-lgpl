// 静的リンクされた実行時部品（mingw-w64・winpthreads・GCC の実行時ライブラリ）の条文の検査。
// Release の zip は exe を配るので、FFmpeg・OpenH264 に加えてこれらの条文も要る。
// - LICENSES/ に条文の写しがあり、中身が写し元（上流の版の LICENSE / COPYING）と同じ（SHA256 で固定）
// - README から各条文と写し元へ辿れる
// - build.yml が LICENSES/ を zip の <NAME>/licenses/ に入れ、SHA256SUMS の zip の値を直す（zip があれば実際に走らせる）
// 実行: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const readme = read('README.md');
const workflow = read('.github/workflows/build.yml');

// 写し元は omniview の docs/legal/licenses/ffmpeg-components/（components.json の files[].source）と同じ
const RUNTIME = [
  { file: 'mingw-w64-COPYING', phrase: 'Zope Public License (ZPL) Version 2.1', sha256: '99a69660981156c21336fdb5661f89341b013c94e4bf9e1c7467b4745718397f',
    source: 'https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/COPYING' },
  { file: 'mingw-w64-COPYING.MinGW-w64-runtime.txt', phrase: 'MinGW-w64 runtime licensing', sha256: 'e9b2dc02451ea29092a1f25fa0f3c07207ed421f1807dffb0c4e6dce69dee7bd',
    source: 'https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt' },
  { file: 'mingw-w64-COPYING.MinGW-w64.txt', phrase: 'MinGW-w64', sha256: 'f38e6194bd3bfa1b654f118e5acefe0aead437bbe669eee43957ccc65a7127f1',
    source: 'https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/COPYING.MinGW-w64/COPYING.MinGW-w64.txt' },
  { file: 'mingw-w64-winpthreads-COPYING', phrase: 'Permission is hereby granted, free of charge', sha256: '63263614cdd29f2f93cba85e992f041b31f9fc7b4033692f31269489a8a1b177',
    source: 'https://raw.githubusercontent.com/mingw-w64/mingw-w64/v11.0.1/mingw-w64-libraries/winpthreads/COPYING' },
  { file: 'GCC-COPYING.RUNTIME', phrase: 'GCC RUNTIME LIBRARY EXCEPTION', sha256: '9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74',
    source: 'https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-13.2.0/COPYING.RUNTIME' },
];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

test('LICENSES/ に mingw-w64（winpthreads を含む）と GCC の実行時ライブラリの条文があり、写し元と同じ中身', () => {
  for (const r of RUNTIME) {
    const buf = readFileSync(join(root, 'LICENSES', r.file));
    assert.ok(buf.toString('utf8').includes(r.phrase), `${r.file}: 「${r.phrase}」が無い`);
    assert.equal(sha256(buf), r.sha256, `${r.file}: 写し元と中身が違う`);
  }
});

test('README から各条文と写し元へ辿れ、zip に licenses/ が入ると書いてある', () => {
  for (const r of RUNTIME) {
    assert.ok(readme.includes(`](LICENSES/${r.file})`), `README に LICENSES/${r.file} へのリンクが無い`);
    assert.ok(readme.includes(r.source), `README に ${r.file} の写し元 ${r.source} が無い`);
  }
  assert.match(readme, /`ffmpeg-lgpl-\*\.zip` \|[^\n]*`licenses\/`/);
});

// steps の「      - 」ごとに区切り、name と run（| の複数行）を取り出す（job ごと）
const jobs = workflow.slice(workflow.indexOf('\njobs:\n')).split(/\n(?= {2}[\w-]+:\n)/).filter((b) => /^ {2}[\w-]+:$/m.test(b));
const stepsOf = (job) => job.slice(job.indexOf('    steps:')).split(/\n {6}- /).slice(1).map((block) => {
  const name = /^name: (.*)$/m.exec(block)?.[1] ?? '';
  // | の本文は 10 桁の字下げの行（と空行）だけ
  const m = /^ {8}run: \|\n((?: {10}.*\n|\n)*)/m.exec(`${block}\n`);
  const run = m ? m[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n').replace(/\n+$/, '') : (/^ {8}run: (.*)$/m.exec(block)?.[1] ?? '');
  return { name, run };
});
const isLicenseStep = (s) => /cp -- LICENSES\/\*/.test(s.run);

test('build.yml: ビルドする job はどれも、build.sh の後・Release の前に LICENSES/ を zip に入れて SHA256SUMS を直す', () => {
  const buildJobs = jobs.map(stepsOf).filter((steps) => steps.some((s) => s.run.includes('bash build.sh')));
  assert.ok(buildJobs.length >= 1);
  for (const steps of buildJobs) {
    const iBuild = steps.findIndex((s) => s.run.includes('bash build.sh'));
    const iLic = steps.findIndex(isLicenseStep);
    const iPub = steps.findIndex((s) => /gh release create/.test(s.run));
    assert.ok(iLic > iBuild, '条文を zip に入れる step が build.sh の後に無い');
    if (iPub >= 0) assert.ok(iLic < iPub, '条文を zip に入れる step が Release の後にある');
    const run = steps[iLic].run;
    assert.match(run, /zip -qr "\$OUT\/\$NAME\.zip" "\$NAME\/licenses"/);
    assert.match(run, /SHA256SUMS/);
    assert.match(run, /sha256sum -c --ignore-missing SHA256SUMS/);
  }
  assert.match(workflow, /paths:\n(?: {6}- .*\n)*? {6}- 'LICENSES\/\*\*'/, 'LICENSES/ の変更でもビルドと検査が走る');
});

// zip が無い手元（Windows など）では飛ばす。CI（ubuntu-24.04）では必ず走らせる。
const hasZip = ['zip', 'unzip', 'sha256sum'].every((t) => spawnSync('bash', ['-c', `command -v ${t}`]).status === 0);
test('build.yml の条文の step を実際に走らせると、zip に LICENSES/ の全ファイルが入り SHA256SUMS が合う', { skip: !hasZip && !process.env.CI && 'zip / unzip が無い' }, () => {
  const steps = jobs.map(stepsOf).flat().filter(isLicenseStep);
  assert.ok(steps.length >= 1);
  const tmp = mkdtempSync(join(tmpdir(), 'aevff-lic-'));
  try {
    const NAME = 'ffmpeg-lgpl-0.0-r0';
    const OUT = join(tmp, 'out');
    mkdirSync(join(OUT, NAME, 'bin'), { recursive: true });
    mkdirSync(join(tmp, 'runner'));
    writeFileSync(join(OUT, NAME, 'bin', 'ffmpeg.exe'), 'dummy exe');
    writeFileSync(join(OUT, NAME, 'LICENSE.txt'), 'dummy');
    writeFileSync(join(OUT, 'NAME'), `${NAME}\n`);
    writeFileSync(join(OUT, 'build.sh'), 'dummy build.sh');
    // build.sh の最後と同じ形の zip と SHA256SUMS を作る
    const make = spawnSync('bash', ['-eo', 'pipefail', '-c',
      `cd "$OUT" && zip -qr "$NAME.zip" "$NAME" && rm -r "$NAME" && unzip -p "$NAME.zip" "$NAME/bin/ffmpeg.exe" | sha256sum | sed "s|-\\$|$NAME/bin/ffmpeg.exe|" > SHA256SUMS && sha256sum -- *.zip build.sh >> SHA256SUMS`],
      { env: { ...process.env, OUT, NAME }, encoding: 'utf8' });
    assert.equal(make.status, 0, make.stderr);
    const before = readFileSync(join(OUT, 'SHA256SUMS'), 'utf8');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', steps[0].run],
      { cwd: root, env: { ...process.env, OUT, RUNNER_TEMP: join(tmp, 'runner') }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const list = spawnSync('unzip', ['-Z1', join(OUT, `${NAME}.zip`)], { encoding: 'utf8' }).stdout.split('\n');
    for (const f of readdirSync(join(root, 'LICENSES'))) assert.ok(list.includes(`${NAME}/licenses/${f}`), `zip に ${f} が無い`);
    for (const f of RUNTIME) assert.ok(list.includes(`${NAME}/licenses/${f.file}`), `zip に ${f.file} が無い`);
    assert.ok(list.includes(`${NAME}/bin/ffmpeg.exe`), 'zip から exe が消えた');
    const after = readFileSync(join(OUT, 'SHA256SUMS'), 'utf8');
    assert.equal(after.split('\n').length, before.split('\n').length, 'SHA256SUMS の行数が変わった');
    assert.equal(after.split('\n')[0], before.split('\n')[0], 'exe の行が変わった');
    // sha256sum の出力は「値  名前」（Git Bash では「値 *名前」）
    const zipLine = after.split('\n').find((l) => l.endsWith(`${NAME}.zip`));
    assert.match(zipLine ?? '', new RegExp(`^${sha256(readFileSync(join(OUT, `${NAME}.zip`)))} [ *]${NAME}\\.zip$`), 'SHA256SUMS の zip の値が新しい zip と合わない');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

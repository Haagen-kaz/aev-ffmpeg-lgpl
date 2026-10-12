// .github/workflows/build.yml の分岐と権限の検査。
// 同じ repo の枝からの PR でも token に書き込み権限があるので、Release の段が PR で走ると
// 審査前のコードで作った ffmpeg.exe が Release に公開されてしまう。
// そこで PR ではビルドと検査（build.sh）だけを読み取り権限（contents: read）の job で行い、
// Release の作成は main での push と手動実行（workflow_dispatch）のときだけ、書き込み権限のある job で行う。
// ワークフローを文字列で読み、job と step の if をトリガーごとの値で評価して、どの step がどの権限で走るかを確かめる。
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');


// インデント indent の「permissions:」の下の「key: value」を読む。無ければ空。
function parsePermissions(text, indent) {
  const m = new RegExp(`^ {${indent}}permissions:(.*)$`, 'm').exec(text);
  if (!m) return {};
  assert.equal(m[1].trim(), '', `permissions は key: value の形で書く: ${m[0]}`);
  const perms = {};
  for (const line of text.slice(m.index + m[0].length + 1).split('\n')) {
    const p = new RegExp(`^ {${indent + 2}}([\\w-]+): (\\S+)$`).exec(line);
    if (!p) break;
    perms[p[1]] = p[2];
  }
  return perms;
}

// steps: の下の「      - 」ごとに区切り、name・if と run（複数行の | も含む）を取り出す
function parseSteps(text) {
  const body = text.slice(text.indexOf('    steps:'));
  return body.split(/\n {6}- /).slice(1).map((block) => {
    const step = { name: '', run: '' };
    const raws = block.split('\n');
    const lines = raws.map((raw, i) => (i === 0 ? raw : raw.replace(/^ {8}/, '')));
    lines.forEach((line, i) => {
      const m = /^(name|if|run): (.*)$/.exec(line);
      if (!m) return;
      if (m[1] !== 'run') step[m[1]] = m[2].trim();
      else if (m[2].trim() !== '|') step.run = m[2].trim();
      else {
        // | の本文は 10 桁以上の字下げの行（と空行）だけ。最後の step の後ろの job のコメントは含めない
        const end = raws.slice(i + 1).findIndex((raw) => raw !== '' && !/^ {10}/.test(raw));
        step.run = lines.slice(i + 1, end < 0 ? undefined : i + 1 + end).join('\n').replace(/\n+$/, '');
      }
    });
    return step;
  });
}

// jobs: の下の「  <id>:」ごとに区切る
function parseJobs(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + '\njobs:\n'.length);
  // 先頭のコメント行だけの塊は job ではないので除く
  return body.split(/\n(?= {2}[\w-]+:\n)/).filter((block) => /^ {2}[\w-]+:$/m.test(block)).map((block) => {
    const id = /^ {2}([\w-]+):$/m.exec(block)[1];
    const jobIf = /^ {4}if: (.*)$/m.exec(block)?.[1].trim();
    return { id, if: jobIf, permissions: parsePermissions(block, 4), steps: parseSteps(block) };
  });
}

const REPO = 'Haagen-kaz/aev-ffmpeg-lgpl';
const triggers = [
  { label: 'pull_request（同じ repo の枝）', event: 'pull_request', ref: 'refs/pull/1/merge', headRepo: REPO },
  { label: 'pull_request（フォーク）', event: 'pull_request', ref: 'refs/pull/2/merge', headRepo: 'someone/aev-ffmpeg-lgpl' },
  { label: 'push（main）', event: 'push', ref: 'refs/heads/main', headRepo: null },
  { label: 'workflow_dispatch（main）', event: 'workflow_dispatch', ref: 'refs/heads/main', headRepo: null },
  { label: 'workflow_dispatch（main 以外の枝）', event: 'workflow_dispatch', ref: 'refs/heads/feature/x', headRepo: null },
];
const publishes = (t) => (t.event === 'push' || t.event === 'workflow_dispatch') && t.ref === 'refs/heads/main';

// この yml の if で使う式（github.event_name・github.ref・github.repository・PR の head の repo・== != ! && || 括弧・文字列）だけを JS にして評価する。
// GitHub Actions では存在しないプロパティは null になる。
function evalIf(expr, t) {
  if (expr === undefined) return true;
  let e = expr.replace(/^(["'])(.*)\1$/, '$2').trim();
  e = e.replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim();
  assert.match(e, /^[\sA-Za-z_.()'!=&|/0-9-]*$/, `想定していない式: ${expr}`);
  const js = e
    .replace(/github\.event\.pull_request\.head\.repo\.full_name/g, '__head')
    .replace(/github\.event_name/g, '__event')
    .replace(/github\.repository/g, '__repo')
    .replace(/github\.ref/g, '__ref')
    .replace(/==/g, '===')
    .replace(/!===/g, '!==');
  assert.doesNotMatch(js, /github\./, `評価できない値: ${expr}`);
  const fn = new Function('__event', '__ref', '__repo', '__head', `return Boolean(${js});`);
  return fn(t.event, t.ref, REPO, t.headRepo);
}

const workflowPermissions = parsePermissions(workflow, 0);
const jobs = parseJobs(workflow);
// job の実際の権限: job に permissions があればそれ、無ければワークフローの permissions
const effectivePermissions = (j) => (Object.keys(j.permissions).length > 0 ? j.permissions : workflowPermissions);
const canWrite = (j) => Object.values(effectivePermissions(j)).some((v) => v === 'write' || v === 'write-all');
const ranJobs = (t) => jobs.filter((j) => evalIf(j.if, t));
const ran = (t) => ranJobs(t).flatMap((j) => j.steps.filter((s) => evalIf(s.if, t)));
const isPublish = (s) => /gh release (create|upload|edit|delete)/.test(s.run);
const isBuild = (s) => s.run.includes('bash build.sh');

test('build.yml: Release を作る step とビルドの step がある（読み取りの確認）', () => {
  assert.ok(jobs.length >= 1);
  assert.equal(jobs.flatMap((j) => j.steps).filter(isPublish).length, 1);
  assert.ok(jobs.some((j) => j.steps.some(isBuild)));
});

test('build.yml: PR（同じ repo の枝・フォークとも）ではビルドと検査だけ走り、Release は作らない', () => {
  assert.match(workflow, /^ {2}pull_request:/m, 'PR でのビルドと検査は残す');
  for (const t of triggers.filter((x) => x.event === 'pull_request')) {
    assert.ok(ran(t).some(isBuild), `${t.label}: ビルドが走らない`);
    assert.ok(!ran(t).some(isPublish), `${t.label}: Release を作ってしまう`);
  }
});

test('build.yml: main への push と main での手動実行ではビルドして Release を作る', () => {
  assert.match(workflow, /push:\n {4}branches: \[main\]/);
  for (const t of triggers.filter(publishes)) {
    assert.ok(ran(t).some(isBuild), `${t.label}: ビルドが走らない`);
    assert.ok(ran(t).some(isPublish), `${t.label}: Release を作らない`);
  }
});

test('build.yml: main 以外の枝での手動実行はビルドと検査だけで、Release は作らない', () => {
  const t = triggers.find((x) => x.event === 'workflow_dispatch' && x.ref !== 'refs/heads/main');
  assert.ok(ran(t).some(isBuild), `${t.label}: ビルドが走らない`);
  assert.ok(!ran(t).some(isPublish), `${t.label}: Release を作ってしまう`);
});

test('build.yml: 既定の権限は読み取りだけで、書き込み権限は Release を作る job だけに付く', () => {
  assert.deepEqual(workflowPermissions, { contents: 'read' }, 'ワークフロー全体の permissions は contents: read');
  for (const j of jobs.filter(canWrite)) {
    assert.deepEqual(j.permissions, { contents: 'write' }, `${j.id}: 書き込みは contents だけ`);
    assert.ok(j.steps.some(isPublish), `${j.id}: Release を作らない job に書き込み権限がある`);
  }
  for (const j of jobs.filter((x) => x.steps.some(isPublish))) assert.ok(canWrite(j), `${j.id}: Release を作るのに書き込み権限が無い`);
});

test('build.yml: 書き込み権限の job は Release を作るトリガーのときだけ走る', () => {
  for (const t of triggers) {
    const writers = ranJobs(t).filter(canWrite).map((j) => j.id);
    if (publishes(t)) assert.ok(writers.length > 0, `${t.label}: 書き込み権限の job が走らない`);
    else assert.deepEqual(writers, [], `${t.label}: 書き込み権限の job が走る`);
  }
});

test('build.yml: どのトリガーでもビルドは 1 回だけ（job を分けても二重に作らない）', () => {
  for (const t of triggers) assert.equal(ran(t).filter(isBuild).length, 1, `${t.label}: ビルドの回数`);
});

test('build.yml: 検査の job と Release の job のビルド手順は同じ（片方だけ直す漏れを防ぐ）', () => {
  const buildJobs = jobs.filter((j) => j.steps.some(isBuild));
  const recipe = (j) => JSON.stringify(j.steps.filter((s) => !isPublish(s)));
  for (const j of buildJobs) assert.equal(recipe(j), recipe(buildJobs[0]), `${j.id} のビルド手順が ${buildJobs[0].id} と違う`);
});

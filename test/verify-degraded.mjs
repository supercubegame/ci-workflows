#!/usr/bin/env node
/* ===========================================================================
 * 降级用例：触发它，等它红，然后验证它红得对
 * ===========================================================================
 *
 * `selftest-degraded.yml` 跑起来一定失败,那就是它的结论。这个脚本负责把它
 * dispatch 起来、等完、然后断言：
 *
 *   1. 那次运行的结论确实是 failure
 *   2. 「回写报告」和「闸门失败或报告降级则失败」两个步骤确实是 failure
 *   3. 评论仍然送达了，自称降级，且没有 composer 哨兵
 *   4. 评论里带着闸门 stdout 的尾巴
 *
 * 第 1 条最容易写成空的。如果那次运行的结论是 success，说明降级根本没让它红,
 * 而那正是这条用例存在的全部理由。所以它是硬断言：结论不是 failure 就报错，
 * 而不是「跑完了就算过」。
 *
 * **找那次运行靠 run-name 里的 marker，不是靠时间挑最近的一次。** 并发下按
 * 时间猜会挑错运行，而挑错之后后面每条断言都在验别人的结果,那种绿最难发现。
 * =========================================================================== */
import { spawnSync } from 'node:child_process';

const WORKFLOW = 'selftest-degraded.yml';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY;
const REF = process.env.GITHUB_REF_NAME;
const TOKEN = process.env.GH_TOKEN;
const MARKER = process.argv[2];

// 从 dispatch 到「那次运行出现在列表里」通常几秒，给足余量。
const APPEAR_TIMEOUT_MS = 180000;
// 那次运行本身：假闸门约 10s，取 composer 的 curl 会重试 5 次（404 也重试，
// 每次隔 3s），然后回写。正常一两分钟。
const FINISH_TIMEOUT_MS = 900000;
const POLL_MS = 5000;

if (!MARKER) { console.error('用法: node test/verify-degraded.mjs <marker>'); process.exit(2); }
if (!TOKEN) { console.error('缺 GH_TOKEN'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(pathname, init){
  const res = await fetch(API + pathname, {
    ...init,
    headers: {
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init && init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const verb = init && init.method === 'POST' ? 'POST' : 'GET';
    throw new Error(verb + ' ' + pathname + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
  }
  return res.status === 204 ? null : res.json();
}

console.log('· 触发 ' + WORKFLOW + '，ref=' + REF);
console.log('· marker ' + MARKER);

await api('/repos/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches', {
  method: 'POST',
  body: JSON.stringify({ ref: REF, inputs: { marker: MARKER } }),
});

// run-name 里印着 marker，所以这里是精确匹配，不是「最近那次」。
let run = null;
const appearDeadline = Date.now() + APPEAR_TIMEOUT_MS;
while (Date.now() < appearDeadline && !run){
  await sleep(POLL_MS);
  const data = await api('/repos/' + REPO + '/actions/workflows/' + WORKFLOW + '/runs?event=workflow_dispatch&per_page=50');
  run = (data.workflow_runs || []).find(r => (r.name || '').includes(MARKER)) || null;
}
if (!run){
  console.error('x 等了 ' + (APPEAR_TIMEOUT_MS / 1000) + 's 也没等到 run-name 里带这个 marker 的运行 - dispatch 没生效，或者 run-name 不再印 marker');
  process.exit(1);
}
console.log('· 找到运行 ' + run.id + '：' + run.html_url);

const finishDeadline = Date.now() + FINISH_TIMEOUT_MS;
while (Date.now() < finishDeadline && run.status !== 'completed'){
  await sleep(POLL_MS);
  run = await api('/repos/' + REPO + '/actions/runs/' + run.id);
}
if (run.status !== 'completed'){
  console.error('x 运行 ' + run.id + ' 在 ' + (FINISH_TIMEOUT_MS / 1000) + 's 内没跑完，状态 ' + run.status);
  process.exit(1);
}

// 硬断言。结论是 success 意味着降级没有让它红,这条用例的全部意义就没了。
if (run.conclusion !== 'failure'){
  console.error('x 降级用例那次运行的结论是 ' + run.conclusion + '，应该是 failure。');
  console.error('  降级没有让 job 变红，就等于报告可以静默地退化成一份没有证据的东西,');
  console.error('  而外面看起来一切正常。' + run.html_url);
  process.exit(1);
}
console.log('· 那次运行的结论是 failure（正确,红是它的结论）');

// 剩下的交给送达验证：评论在不在、说没说自己降级、带没带日志尾巴、
// 以及那两个步骤是不是真的红。
const res = spawnSync(process.execPath, [
  'test/verify-delivery.mjs',
  '--marker', MARKER,
  '--degraded',
  '--expect-one',
  '--run-id', String(run.id),
  '--job', '降级用例',
  '--failed-steps', '回写报告,闸门失败或报告降级则失败',
], { stdio: 'inherit' });

process.exit(res.status === null ? 1 : res.status);

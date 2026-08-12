#!/usr/bin/env node
/* ===========================================================================
 * 假闸门
 * ===========================================================================
 *
 * 它不验证任何东西,它的工作是**产出和真调用方形状完全一致的东西**，好让
 * report.yml 有真实的输入可以处理：
 *
 *   artifacts/report-fake.json   composer 要读的报告
 *   artifacts/stdout-fake.log    stdout 的副本
 *
 * 那份 stdout 日志不是摆设。composer 加载失败时，降级评论里带的就是它的
 * 尾巴,自检的降级用例会去评论里找这行哨兵，以此证明「报告缺失时仍然带着
 * 证据」这条真的成立，而不只是代码里写了。
 * =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const ART = path.resolve('artifacts');
fs.mkdirSync(ART, { recursive: true });

// 降级评论里要能找到这一行。改它就要同步改 test/verify-delivery.mjs。
const SENTINEL = 'FAKE-GATE-STDOUT-SENTINEL';

const lines = [
  '假闸门开始',
  SENTINEL + ' 这一行必须出现在降级评论的日志尾巴里',
  'PASS  假检查 1',
  'PASS  假检查 2',
  '假闸门结束：2/2 通过',
];

for (const line of lines) console.log(line);
fs.writeFileSync(path.join(ART, 'stdout-fake.log'), lines.join('\n') + '\n');

fs.writeFileSync(path.join(ART, 'report-fake.json'), JSON.stringify({
  name: '假闸门',
  passed: 2,
  total: 2,
  ok: true,
  sentinel: SENTINEL,
  ranAt: new Date().toISOString(),
}, null, 2));

process.exit(0);

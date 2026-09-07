#!/usr/bin/env node
// stdout-fake.log belongs exclusively to the workflow tee process.
// Direct invocation writes JSON and stdout, not a second competing log file.
import fs from 'node:fs';
import path from 'node:path';
import { policySummary } from './report-post.test.mjs';
import './log-writer.test.mjs';

const ART = path.resolve('artifacts');
fs.mkdirSync(ART, { recursive: true });
const SENTINEL = 'FAKE-GATE-STDOUT-SENTINEL';
const lines = [
  '假闸门开始',
  SENTINEL + ' 这一行必须出现在降级评论的日志尾巴里',
  'PASS  假检查 1',
  'PASS  假检查 2',
  'Production report script checks: ' + policySummary.passed + '/' + policySummary.total,
  '假闸门结束：2/2 通过',
];
for (const line of lines) console.log(line);
fs.writeFileSync(path.join(ART, 'report-fake.json'), JSON.stringify({
  name: '假闸门', passed: 2, total: 2, ok: true, sentinel: SENTINEL,
  policy: policySummary, ranAt: new Date().toISOString(),
}, null, 2));
process.exit(0);

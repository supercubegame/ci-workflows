#!/usr/bin/env node
/* ===========================================================================
 * 假 composer
 * ===========================================================================
 *
 * 履行 report.yml 对 composer 的契约，仅此而已：
 *
 *   node test/compose-report.mjs <目录>            写出 comment.md
 *   node test/compose-report.mjs <目录> --check    不写文件，只用退出码表态
 *
 * 真项目的 composer 要做的事情多得多（合并多条闸门、报告缺失时带日志尾巴、
 * 折叠长输出）。这里只需要「契约成立」,自检验证的是送达，不是排版。
 * =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) || 'reports';
const checkOnly = args.includes('--check');

function findFile(name){
  const hits = [];
  const walk = d => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries){
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === name) hits.push(p);
    }
  };
  walk(dir);
  return hits[0] || null;
}

const file = findFile('report-fake.json');
let data = null;
try { data = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch (e) { data = null; }

// 报告缺失算失败。这条和真 composer 一样,一个在写出报告之前就崩掉的 job
// 绝不能看起来像通过。
const failed = !data || data.passed !== data.total;

if (checkOnly){
  process.stdout.write((failed ? 'FAILED' : 'PASSED') + '\n');
  process.exit(failed ? 1 : 0);
}

// 这一行是自检用例在评论里找的哨兵：它只可能来自 composer 真的跑过。
// 降级评论里没有它,所以「完整」和「降级」两种评论是可区分的。
const body = [
  '## ci-workflows 自检',
  '',
  'COMPOSER-RAN-SENTINEL',
  '',
  data
    ? '假闸门 ' + data.passed + '/' + data.total + ' 通过'
    : '没有找到假闸门的报告,这条评论本身就是失败的证据',
  '',
  '提交 `' + String(process.env.GITHUB_SHA || 'local').slice(0, 7) + '`',
  '',
].join('\n');

fs.writeFileSync('comment.md', body);
process.stdout.write(body + '\n');

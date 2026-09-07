import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
// Run the real producer body with only its test imports replaced, avoiding recursive tests.
const original=fs.readFileSync(new URL('./fake-gate.mjs',import.meta.url),'utf8');
const policyImport="import { policySummary } from './report-post.test.mjs';";
const selfImport="import './log-writer.test.mjs';";
assert.equal(original.split(policyImport).length,2);
assert.equal(original.split(selfImport).length,2);
const body=original.replace(policyImport,'const policySummary={passed:43,total:43};').replace(selfImport,'');
function inspect(stdout,log){
 assert(!log.includes(0),'NUL byte in tee log');
 assert(stdout.equals(log),'tee log differs from stdout');
 for(const token of ['FAKE-GATE-STDOUT-SENTINEL','假闸门开始','假闸门结束：2/2 通过'])
  assert.equal(log.toString().split(token).length-1,1,'duplicated or missing producer line');
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'single-log-'));
try{
 fs.writeFileSync(path.join(dir,'producer.mjs'),body);
 for(let i=0;i<3;i++){
  const p=spawnSync('bash',['-e','-o','pipefail','-c','mkdir -p artifacts; node producer.mjs | tee artifacts/stdout-fake.log'],{cwd:dir,timeout:15000});
  assert.equal(p.status,0,p.stderr?.toString());
  const log=fs.readFileSync(path.join(dir,'artifacts/stdout-fake.log'));
  inspect(p.stdout,log);
  assert.throws(()=>inspect(p.stdout,Buffer.concat([log,Buffer.from([0])])));
  assert.throws(()=>inspect(p.stdout,Buffer.concat([log,log])));
 }
 // Reintroduce the exact old log-write statement; direct invocation must expose the second writer.
 const mutant=body.replace('for (const line of lines) console.log(line);',"for (const line of lines) console.log(line);\nfs.writeFileSync(path.join(ART, 'stdout-fake.log'), lines.join('\\n') + '\\n');");
 assert.notEqual(mutant,body);
 fs.rmSync(path.join(dir,'artifacts/stdout-fake.log'));
 const clean=spawnSync(process.execPath,['producer.mjs'],{cwd:dir,timeout:15000});assert.equal(clean.status,0);
 assert(!fs.existsSync(path.join(dir,'artifacts/stdout-fake.log')),'producer must not own tee file');
 fs.writeFileSync(path.join(dir,'mutant.mjs'),mutant);
 const bad=spawnSync(process.execPath,['mutant.mjs'],{cwd:dir,timeout:15000});assert.equal(bad.status,0);
 assert(fs.existsSync(path.join(dir,'artifacts/stdout-fake.log')),'old second writer was not reproduced');
 console.log('Single-writer regression: 3 actual tee runs exact; NUL/duplicate controls rejected; old second writer reproduced.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

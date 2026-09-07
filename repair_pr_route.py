"""Bounded repair: preserve workflow except target selection; run real-script tests before/after."""
from pathlib import Path
import hashlib, subprocess

def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def once(s,a,b):
    assert s.count(a)==1,a[:90]
    return s.replace(a,b,1)
p=Path('.github/workflows/report.yml');t=Path('test/report-post.test.mjs')
s=p.read_text();tests=t.read_text()
if 'Direct event PR lookup' in s:
    subprocess.run(['node','test/report-post.test.mjs'],check=True);raise SystemExit(0)
assert blob(p.read_bytes())=='ccc30dbf35233ea80b8f0f664e3c608ae028fd42'
assert blob(t.read_bytes())=='be53fb05be7744e161a44aa1530fe9aef20879a6'
# First prove the old production script takes the wrong branch with a missing association.
probe="""await test('PR event with empty merge association still reaches current PR', async () => {
  const r = await scenario({kind:'pr',executionSha:'b'.repeat(40),eventPR:PR,associated:[]});
  assert.equal(r.caught, null); assert.equal(r.writes.length, 1);
});
"""
t.write_text(once(tests,'export const policySummary',probe+'export const policySummary'))
r=subprocess.run(['node','test/report-post.test.mjs'],text=True,capture_output=True)
assert r.returncode!=0 and 'wrong destination' in r.stderr,r.stdout+r.stderr
print('BASELINE RED: real production script wrongly falls back to commit when merge association is empty',flush=True)
t.write_text(tests)
start=s.index('            const eventPR = context.payload && context.payload.pull_request;')
end=s.index('\n\n              if (open)',start) if '\n\n              if (open)' in s[start:] else s.index('\n\n              //',start)
# indentation differs: eventPR lives inside postOnce; isolate by exact following marker.
end=s.index('\n\n              if (open)',start)
old=s[start:end]
assert 'const open = candidates[0];' in old and 'listPullRequestsAssociatedWithCommit' in old
new="""            const eventPR = context.payload && context.payload.pull_request;
              let open;
              // Direct event PR lookup: merge-commit association is not authoritative.
              if (eventPR) {
                if (!Number.isSafeInteger(eventPR.number) || eventPR.number < 1 ||
                    !/^[0-9a-f]{40}$/.test(eventPR.head && eventPR.head.sha || '') ||
                    !eventPR.base || !eventPR.base.repo || eventPR.base.repo.full_name !== repository) {
                  reject('invalid PR event target');
                }
                const { data: current } = await github.rest.pulls.get({owner, repo, pull_number:eventPR.number});
                if (!current || current.number !== eventPR.number || !current.base || !current.base.repo ||
                    current.base.repo.full_name !== repository || !['open','closed'].includes(current.state) ||
                    !/^[0-9a-f]{40}$/.test(current.head && current.head.sha || '')) reject('invalid current PR target');
                if (current.state === 'open' && current.head.sha === eventPR.head.sha) open = current;
                else core.info('PR target no longer current; using execution commit (closed or head changed)');
              } else {
                const associated = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
                  owner, repo, commit_sha: context.sha, per_page: 100
                });
                const candidates = associated.filter(pr => pr.state === 'open' && pr.head && pr.head.sha === context.sha && pr.base && pr.base.repo && pr.base.repo.full_name === repository);
                if (candidates.length > 1) reject('ambiguous current PR targets: ' + candidates.length);
                open = candidates[0];
              }"""
s=s[:start]+new+s[end:];p.write_text(s)
tests=once(tests,'  const github = {rest: {',"""  const github = {rest: {
    pulls: {get: async args => {
      assert.equal(args.pull_number, options.eventPR.number);
      if(options.getError) throw new Error(options.getError);
      return {data: options.currentPR || associated.find(p => p.number===options.eventPR.number) || options.eventPR};
    }},""")
# Old association-only fixture is irrelevant for an event with an independently verified current PR.
tests=once(tests,"const r = await scenario({executionSha:'b'.repeat(40),eventPR:PR,associated:[{...PR,number:10}]});","const r = await scenario({kind:'pr',executionSha:'b'.repeat(40),eventPR:PR,associated:[{...PR,number:10}]});")
extra=probe+"""await test('direct PR read error cannot silently fall back', async () => {
  const r=await scenario({kind:'pr',eventPR:PR,associated:[],getError:'403 denied'});
  assert.match(r.caught?.message||'',/403/);assert.equal(r.writes.length,0);
});
for(const [label,currentPR] of [
 ['wrong repository',{...PR,base:{repo:{full_name:'other/repo'}}}],
 ['wrong number',{...PR,number:10}],
 ['invalid state',{...PR,state:'unknown'}],
 ['missing head',{...PR,head:{}}]
]) await test('direct PR rejects '+label,async()=>{
 const r=await scenario({kind:'pr',eventPR:PR,currentPR});
 assert.match(r.caught?.message||'',/invalid current PR/);assert.equal(r.writes.length,0);
});
await test('direct PR read sees closure and uses execution commit',async()=>{
 const r=await scenario({executionSha:'b'.repeat(40),eventPR:PR,currentPR:{...PR,state:'closed'},associated:[]});
 assert.equal(r.caught,null);assert.equal(r.writes.length,1);
});
await test('invalid event repository is refused before writing',async()=>{
 const r=await scenario({eventPR:{...PR,base:{repo:{full_name:'other/repo'}}}});
 assert.match(r.caught?.message||'',/invalid PR event/);assert.equal(r.writes.length,0);
});
"""
tests=once(tests,'export const policySummary',extra+'export const policySummary');t.write_text(tests)
subprocess.run(['node','test/report-post.test.mjs'],check=True)
print('GREEN: real production-script tests passed; original tests preserved with updated direct-read expectations',flush=True)

import assert from 'node:assert/strict';
import fs from 'node:fs';

// Execute the actual workflow JS, not a parallel reimplementation of its policy.
const yaml = fs.readFileSync(new URL('../.github/workflows/report.yml', import.meta.url), 'utf8');
const post = yaml.split('\n        id: post\n');
assert.equal(post.length, 2, 'exactly one production post step');
const region = post[1].split('\n      # 判定')[0];
const blocks = region.split('          script: |\n');
assert.equal(blocks.length, 2, 'exactly one production script');
const lines = blocks[1].trimEnd().split('\n');
assert(lines.length > 40 && lines.every(line => !line.trim() || line.startsWith('            ')), 'complete script indentation');
const source = lines.map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('require', 'context', 'github', 'core', 'process', 'setTimeout', source);
const SHA = 'a'.repeat(40);
const API = 'https://api.github.com/repos/owner/repo';
const MARKER = '<!-- policy-test -->';
const BOT = {id: 41898282, login: 'github-actions[bot]'};
const PR = {number: 9, state: 'open', head: {sha: SHA}, base: {repo: {full_name: 'owner/repo'}}};
const old = (kind, patch = {}) => ({id: 7, user: {...BOT}, body: MARKER + '\nold',
  ...(kind === 'pr' ? {issue_url: API + '/issues/9'} : {commit_id: SHA}), ...patch});

async function scenario(options = {}) {
  const kind = options.kind || 'commit';
  const comments = structuredClone(options.comments || []);
  const writes = [], infos = [], failures = [];
  let caught = null;
  const associated = options.associated || (kind === 'pr' ? [PR] : []);
  const listPR = async () => ({data: associated});
  const listIssue = async () => ({data: comments});
  const listCommit = async () => ({data: comments});
  const create = destination => async args => {
    assert.equal(destination, kind, 'write went to the wrong destination');
    if (kind === 'pr') assert.equal(args.issue_number, 9);
    else assert.equal(args.commit_sha, SHA);
    const value = old(kind, {id: 100 + writes.length, body: args.body});
    comments.push(value); writes.push({operation: 'create', ...args});
    return {data: value};
  };
  const update = destination => async args => {
    assert.equal(destination, kind, 'update went to the wrong destination');
    const value = comments.find(c => c.id === args.comment_id);
    assert(value, 'unknown update id');
    value.body = args.body; writes.push({operation: 'update', ...args});
    return {data: value};
  };
  const get = async args => {
    const item = comments.find(c => c.id === args.comment_id);
    assert(item, 'readback id missing');
    return {data: {...item, ...(options.readback || {})}};
  };
  const github = {rest: {
    repos: {listPullRequestsAssociatedWithCommit: listPR, listCommentsForCommit: listCommit,
      createCommitComment: create('commit'), updateCommitComment: update('commit'), getCommitComment: get},
    issues: {listComments: listIssue, createComment: create('pr'), updateComment: update('pr'), getComment: get},
  }, paginate: async (fn, args) => (await fn(args)).data};
  const summary = {addRaw: () => summary, write: async () => {}};
  const core = {summary, info: v => infos.push(v), warning: () => {}, setFailed: v => failures.push(v)};
  const env = {MARKER, GITHUB_API_URL: 'https://api.github.com', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_REPOSITORY: 'owner/repo', GITHUB_SERVER_URL: 'https://github.com', ...(options.env || {})};
  const require = name => {
    assert.equal(name, 'fs');
    return {existsSync: () => Boolean(options.degraded), readFileSync: path => {
      assert.equal(path, 'comment.md'); return options.text ?? 'current composer payload';
    }};
  };
  try {
    await execute(require, {repo:{owner:'owner',repo:'repo'},sha:SHA,runId:123}, github, core, {env}, fn => fn());
  } catch (error) { caught = error; }
  return {caught, writes, comments, infos, failures};
}

let total = 0;
const names = [];
async function test(name, fn) {
  await fn(); total++; names.push(name); console.log('PASS report policy: ' + name);
}
for (const kind of ['pr', 'commit']) {
  await test(kind + ': create current report', async () => {
    const r = await scenario({kind});
    assert.equal(r.caught, null); assert.equal(r.writes.length, 1); assert.equal(r.writes[0].operation, 'create');
    assert(r.writes[0].body.startsWith(MARKER + '\n'));
    assert(r.writes[0].body.includes('ci-report-execution:owner/repo:' + SHA + ':123:2'));
  });
  await test(kind + ': update exact owned report', async () => {
    const r = await scenario({kind, comments:[old(kind)]});
    assert.equal(r.caught, null); assert.equal(r.writes.length, 1); assert.equal(r.writes[0].operation, 'update');
    assert.equal(r.writes[0].comment_id, 7);
  });
  for (const [label, patch] of [
    ['quoted marker', {body:'quotation\n'+MARKER}], ['prefix marker', {body:MARKER+' suffix'}],
    ['wrong author id', {user:{...BOT,id:1}}], ['wrong author login', {user:{...BOT,login:'other'}}],
    ['wrong target', kind === 'pr' ? {issue_url:API+'/issues/10'} : {commit_id:'b'.repeat(40)}],
  ]) await test(kind + ': ignore ' + label, async () => {
    const original = old(kind, patch);
    const r = await scenario({kind, comments:[original]});
    assert.equal(r.caught, null); assert.equal(r.writes.length, 1); assert.equal(r.writes[0].operation, 'create');
    assert.deepEqual(r.comments[0], original);
  });
  await test(kind + ': duplicate owned targets stop before write', async () => {
    const r = await scenario({kind, comments:[old(kind),old(kind,{id:8})]});
    assert.match(r.caught?.message || '', /ambiguous/i); assert.equal(r.writes.length, 0);
  });
  for (const [label, patch] of [
    ['stale payload', {body:MARKER+'\nold'}], ['wrong readback id', {id:999}],
    ['wrong readback author', {user:{...BOT,id:1}}],
    ['wrong readback target', kind === 'pr' ? {issue_url:API+'/issues/10'} : {commit_id:'b'.repeat(40)}],
  ]) await test(kind + ': reject ' + label, async () => {
    const r = await scenario({kind, readback:patch});
    assert.match(r.caught?.message || '', /readback/i); assert.equal(r.writes.length, 1);
  });
}
await test('multiple current PRs stop before write', async () => {
  const r = await scenario({kind:'pr',associated:[PR,{...PR,number:10}]});
  assert.match(r.caught?.message || '', /ambiguous/i); assert.equal(r.writes.length, 0);
});
await test('older associated PR does not own current commit', async () => {
  const r = await scenario({associated:[{...PR,head:{sha:'b'.repeat(40)}}]});
  assert.equal(r.caught, null); assert.equal(r.writes[0].operation, 'create');
});
await test('closed PR falls back to commit', async () => {
  const r = await scenario({associated:[{...PR,state:'closed'}]});
  assert.equal(r.caught, null); assert.equal(r.writes.length, 1);
});
await test('degraded report is delivered and fails explicitly', async () => {
  const r = await scenario({degraded:true,text:'报告降级: evidence missing'});
  assert.equal(r.caught, null); assert.equal(r.writes.length, 1); assert.equal(r.failures.length, 1);
});
for (const [label, env] of [
  ['empty marker',{MARKER:''}], ['multiline marker',{MARKER:MARKER+'\nextra'}],
  ['missing attempt',{GITHUB_RUN_ATTEMPT:''}], ['invalid attempt',{GITHUB_RUN_ATTEMPT:'02'}],
]) await test('invalid input: ' + label, async () => {
  const r = await scenario({env}); assert(r.caught, 'invalid input accepted'); assert.equal(r.writes.length, 0);
});
export const policySummary = {suite:'production-report-post',passed:total,total,names};
console.log('Production report script checks: ' + total + '/' + total);

#!/usr/bin/env node
/* ===========================================================================
 * 送达验证
 * ===========================================================================
 *
 * 回头去 GitHub API 上确认：那条评论**真的存在**。
 *
 * 这是整个自检的重点。report.yml 里已经有「发完读回来」了，但那是它自己
 * 验自己,监控自证清白不算数。这个脚本从外面看结果，而且看的是评论列表，
 * 和读评论的人/agent 拿到的是同一份东西。
 *
 * 为什么 marker 里带 run id 和 attempt：陈旧评论。上一次运行留下的评论会
 * 让「找到了带标记的评论」这条断言在回写完全坏掉的情况下照样通过,那就是
 * 一条典型的空断言。带上 run id，只有**这一次**贴出来的才算数。
 *
 * 用法：
 *   node test/verify-delivery.mjs --marker '<!-- x -->' [--degraded]
 *     [--expect-one] [--job '回报结果' --failed-steps '回写报告,闸门失败或报告降级则失败']
 * =========================================================================== */

const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const opt = (name, dflt = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const MARKER = opt('marker');
const DEGRADED = flag('degraded');
const EXPECT_ONE = flag('expect-one');
const JOB_NAME = opt('job');
const FAILED_STEPS = (opt('failed-steps') || '').split(',').map(s => s.trim()).filter(Boolean);

// 假闸门写进 stdout 的哨兵，降级评论应该带上它的日志尾巴。
const STDOUT_SENTINEL = 'FAKE-GATE-STDOUT-SENTINEL';
// composer 真的跑过才会出现在评论里的哨兵。
const COMPOSER_SENTINEL = 'COMPOSER-RAN-SENTINEL';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY;
const SHA = process.env.GITHUB_SHA;
const RUN_ID = process.env.GITHUB_RUN_ID;
const TOKEN = process.env.GH_TOKEN;

if (!MARKER) { console.error('缺 --marker'); process.exit(2); }
if (!TOKEN) { console.error('缺 GH_TOKEN'); process.exit(2); }

async function api(pathname){
  const res = await fetch(API + pathname, {
    headers: {
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error('GET ' + pathname + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

const problems = [];
const notes = [];

try {
  // 这次提交上有没有开着的 PR,report.yml 就是按这个分岔的，所以验证也按
  // 同一个事实分岔，而不是猜。
  const associated = await api('/repos/' + REPO + '/commits/' + SHA + '/pulls');
  const open = associated.find(pr => pr.state === 'open');
  const expected = open ? 'pr' : 'commit';
  notes.push('这次走的是 ' + (open ? 'PR #' + open.number : 'commit ' + SHA.slice(0, 7)) + ' 这条路');

  const prComments = open
    ? await api('/repos/' + REPO + '/issues/' + open.number + '/comments?per_page=100')
    : [];
  const commitComments = await api('/repos/' + REPO + '/commits/' + SHA + '/comments?per_page=100');

  const inPr = prComments.filter(c => (c.body || '').includes(MARKER));
  const inCommit = commitComments.filter(c => (c.body || '').includes(MARKER));
  const hit = expected === 'pr' ? inPr : inCommit;
  const other = expected === 'pr' ? inCommit : inPr;

  if (!hit.length){
    problems.push('该出现评论的地方（' + expected + '）没有找到带这个标记的评论 - 报告没送达，' +
                  '而这正是「两条闸门全绿却一条评论都没有」的那种失败');
  }
  // 负向孪生：报告不能贴到另一条路上去。有 PR 的时候贴成 commit 评论，
  // 读 PR 的人是看不到的,那和没送出去差别不大。
  if (other.length){
    problems.push('评论同时出现在了另一条路上（' + (expected === 'pr' ? 'commit' : 'PR') +
                  ' 有 ' + other.length + ' 条）- 分岔逻辑选错了地方');
  }
  // 同一个标记只该有一条评论。自检故意用同一个 marker 跑了两遍回写：
  // 第二遍必须是**更新**那一条，而不是再贴一条。刷屏也是一种坏掉。
  if (EXPECT_ONE && hit.length > 1){
    problems.push('带这个标记的评论有 ' + hit.length + ' 条，应该只有 1 条 - 第二次回写没有更新已有的那条，而是又贴了一条');
  }

  const body = hit.length ? hit[0].body : '';

  if (hit.length){
    if (DEGRADED){
      // 降级的报告必须自己说自己是降级的。给不出的结果读起来像干净的一遍，
      // 是这套东西里最不能接受的一种谎。
      if (!body.includes('报告降级')) problems.push('降级的评论没有说自己是降级的 - 它读起来像一份完整报告');
      if (body.includes(COMPOSER_SENTINEL)) problems.push('降级用例里 composer 居然跑成功了 - 这条用例没有测到它想测的东西');
      // 「报告缺失也必须带证据」：日志尾巴要真的在评论里。
      if (!body.includes(STDOUT_SENTINEL)){
        problems.push('降级评论里没有闸门 stdout 的尾巴 - 「没有产出报告」只说明监控坏了，不说明为什么');
      }
    } else {
      if (!body.includes(COMPOSER_SENTINEL)) problems.push('完整的评论里没有 composer 的哨兵 - 送出去的可能是兜底那份');
      if (body.includes('报告降级')) problems.push('composer 明明跑成功了，评论却标成了降级');
    }
  }

  // job / step 级别的断言。降级用例的 caller 是 continue-on-error（否则整条
  // 自检永远是红的），而 continue-on-error 会把 job 的 result 抹成 success,
  // 所以这里不看 job 的结论，看**步骤**的结论：它们不受 continue-on-error 影响。
  if (JOB_NAME && FAILED_STEPS.length){
    const data = await api('/repos/' + REPO + '/actions/runs/' + RUN_ID + '/jobs?per_page=100');
    const jobs = data.jobs || [];
    const job = jobs.find(j => j.name.includes(JOB_NAME));
    if (!job){
      // 非空断言：找不到 job 的话，下面每条「某步骤失败了吗」都会读成没失败。
      problems.push('在这次运行里找不到名字包含「' + JOB_NAME + '」的 job，' +
                    '所以下面关于步骤的断言什么都证明不了 ｜ 实际有：' + jobs.map(j => j.name).join('、'));
    } else {
      const steps = job.steps || [];
      if (!steps.length){
        problems.push('job「' + job.name + '」没有返回任何步骤 - 同上，这段断言是空的');
      }
      for (const want of FAILED_STEPS){
        const step = steps.find(s => s.name.includes(want));
        if (!step){
          problems.push('job 里没有名字包含「' + want + '」的步骤 ｜ 实际有：' + steps.map(s => s.name).join('、'));
        } else if (step.conclusion !== 'failure'){
          problems.push('步骤「' + step.name + '」的结论是 ' + step.conclusion +
                        '，应该是 failure - 降级的报告必须让 job 变红，静默的监控比没有监控更危险');
        } else {
          notes.push('步骤「' + step.name + '」确实红了');
        }
      }
    }
  }

  notes.push('标记 ' + MARKER);
  notes.push('命中 ' + hit.length + ' 条，另一条路上 ' + other.length + ' 条');
} catch (err) {
  problems.push('验证过程本身出错：' + (err && err.message ? err.message : String(err)));
}

for (const n of notes) console.log('  · ' + n);
if (problems.length){
  console.log('\n失败项：');
  for (const p of problems) console.log('  x ' + p);
  process.exit(1);
}
console.log('\n送达验证通过。');
process.exit(0);

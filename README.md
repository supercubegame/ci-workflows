# ci-workflows

共享的 CI 可复用 workflow。目前只有一个：**报告回写**。

## 为什么存在

`.github/workflows/report.yml` 以前在 `image-grabber` 和 `jumpwow` 里各有一份
逐字相同的拷贝。两份拷贝的一致性**没有任何东西在守**：两个仓库的闸门都只看得见
自己那份 workflow，同时改两边就是两边都绿而结构已经分叉。

各自的闸门可以断言「我用的是这个共享 workflow」,那条断言在自己仓库里是硬的。
它们守不住的是「另一边也一样」，而现在不需要守了：只有一份。

## 用法

```yaml
  report:
    name: 回报结果
    needs: [gate, web]
    if: always()
    permissions:
      contents: write         # commit 评论要它
      pull-requests: write    # PR 评论要它
    uses: supercubegame/ci-workflows/.github/workflows/report.yml@main
    with:
      node-version: '22'
      gates: '[{"name":"引擎闸门","result":"${{ needs.gate.result }}"},{"name":"浏览器闸门","result":"${{ needs.web.result }}"}]'
      composer-files: scripts/compose-report.mjs
      composer-entry: scripts/compose-report.mjs
      marker: '<!-- verify-gate -->'
```

调用方要满足的约定，以及每个输入的含义，都写在 `report.yml` 的文件头注释里。
简版：闸门把报告上传成 `report-*` 的 artifact，并且把 stdout tee 成
`stdout-<slug>.log` 一起传,报告缺失时评论里带的就是那份日志的尾巴。

## 这个文件自己也有闸门

**改完 `report.yml` 不要只看「YAML 能解析」。** `selftest.yml` 会起一个假调用方，
让真的 report.yml 跑完整条链路，然后**回头去 API 上确认那条评论真的存在**,
report.yml 内部虽然有「发完读回来」，但那是监控自证清白。

它验的是真实行为：

1. **完整报告送达**,评论查得到，并且带着 composer 的哨兵（证明送出去的不是兜底那份）
2. **回写两次只留一条**,同一个 marker 连发两遍，必须更新而不是刷屏
3. **降级路径**,评论仍然送达、自称降级、带着日志尾巴，并且那次运行真的红

第 2 条在写出来的当天就抓到了一个真 bug：没有 PR 时 commit 那条支路只会新建、
从不更新，marker 只实现了一半。生产里看不出来，因为每次推送都是新 SHA。

`selftest.yml` uses 的是**本地路径**，验的是当前这次改动，不是 `@main` 上那份。

### 有一条运行预期就是红的

`selftest-degraded.yml` 跑起来一定失败,那就是它的结论。它把 composer 指向一个
不存在的文件，用来证明降级时评论仍然送达、自称降级、带着日志尾巴，并且真的变红。

它**不会自己跑**：`selftest.yml` 带一个唯一 marker 把它 dispatch 起来，等它跑完，
然后断言它的结论是 `failure`、那两个步骤是 `failure`、评论送到了且自称降级。
**看到它红，别去修。** 哪天它变绿了，自检才会红。

为什么必须独立成一次运行：调用可复用 workflow 的 job **不支持**
`continue-on-error`（解析器会把它当普通 job 然后报 `runs-on` 缺失），所以一个
预期失败的调用没办法待在整体为绿的运行里。而让自检永远红不是选项。

### 覆盖的局限，别读多了

report.yml 按「这个 commit 上有没有开着的 PR」分岔，所以**一次运行只走一条路**。
验证脚本按同一个事实分岔，断言评论在该在的地方、且没有跑到另一边去。两条路靠
正常生命周期覆盖：开 PR 前推分支走 commit 评论，PR 开着推走 PR 评论，合进 main
又是 commit 评论。一条 PR 从头走到合并，两条都会被真的走一遍。

每次运行的日志里印着这次走的是哪条。**别把单次绿读成两条都验过了。**

### 「PR 开在运行中间」会让 verify-ok 红,那不是误报

先推提交、过几十秒才开 PR，会出现这种情况：第一次回写时还没有 PR，落成 commit
评论；第二次回写时 PR 已经存在，落成 PR 评论。同一个 marker 在两条路上各一条，
于是「不能同时出现在另一条路上」那条断言会红。

**断言说的是实话**,那次提交的报告确实分裂在两个地方，读 PR 的人只看得到后半段。
这是按「当下有没有 PR」分岔的固有后果，不是 bug。要避免就先开 PR 再推，或者重跑。

## 仍然要人负责的部分

改这里会立刻同时改变两个调用方的 CI,自检能证明「报告送得出去」，证明不了
「新的报告内容对那两个项目仍然有意义」。改完顺手去两个仓库各看一眼。

**固定用 `@main`。** 换成 pin SHA，A 仓库停在旧 SHA、B 仓库在新的，两边都绿而
行为已经不同,版本漂移会把刚消灭的那个洞原样请回来。

## 调用方

- [supercubegame/image-grabber](https://github.com/supercubegame/image-grabber)
- [supercubegame/jumpwow](https://github.com/supercubegame/jumpwow)

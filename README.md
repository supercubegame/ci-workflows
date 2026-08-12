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

## 两条要一起记住的事

**固定用 `@main`。** 换成 pin SHA，A 仓库停在旧 SHA、B 仓库在新的，两边都绿而
行为已经不同,版本漂移会把刚消灭的那个洞原样请回来。

**代价：这个文件没有闸门守着。** 改它会同时改变两个项目的 CI，而且是立刻生效。
它自己没有验证流水线,这是目前这套东西里最后一处「靠人小心」的地方，别假装不存在。
改动之后，去两个调用方仓库各看一眼评论真的出现了。

## 调用方

- [supercubegame/image-grabber](https://github.com/supercubegame/image-grabber)
- [supercubegame/jumpwow](https://github.com/supercubegame/jumpwow)

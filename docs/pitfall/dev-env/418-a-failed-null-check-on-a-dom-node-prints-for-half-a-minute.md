# 对一个 happy-dom 节点断言 toBeNull 失败，要打印半分钟

## 现象

`expect(view.queryByText("Retell of A")).toBeNull()` 在节点存在时失败，这一个用例跑了 29 秒，`scripts/t.sh` 的完整日志有 233 万行，终端里只看得到一长串 `[Getter]` / `[Function]`，失败的那行断言被埋在最后。同一个文件里断言正确的用例几毫秒。

## 原因

bun 的 `expect` 失败时把 received 整个格式化出来。received 是 happy-dom 的元素，它的 getter 顺着 `parentElement`、`ownerDocument`、`children` 一路展开，等于把整棵树连同 window 上的对象打一遍。

## 解法

断言"这段文字不在"时比文本，不比节点：`expect(view.container.textContent).not.toContain("...")`。失败信息只有一行，写明实际渲染出来的文字。见 `tests/ui/components/library/topic-section-race.test.tsx`。

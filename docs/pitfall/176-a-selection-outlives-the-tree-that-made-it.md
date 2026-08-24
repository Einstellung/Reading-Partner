# document 的选区比 RTL 卸掉的树活得久，没落成 stroke 的选区漏给下一个用例

## 现象

`tests/ui/components/chat-pen-strokes.test.tsx` 默认顺序全绿，`--seed` 洗过用例顺序之后会红，红在哪个用例随 seed 换：

- `--seed=1`：`a stylus dragged across a reply marks it without making a selection first` 里 `expect(document.getSelection()?.isCollapsed).toBe(true)` 收到 `false`。
- `--seed=4`：`a press on that mark once the finger has gone down again opens it` 里 `expect(opened.map(a => a.id)).toEqual(["c1"])` 收到 `[]`。
- `--seed=2`、`--seed=3` 绿——不是每个 seed 都撞得上，取决于漏了选区的用例有没有排到读它的用例前面。

## 原因

先怀疑过 `chat.tsx` 的两处模块级状态：`strokes`（:225）和 `gesture`（:231）。查了一遍排除了这条路——pointerdown 的 capture 监听器每次按下都调一次 `strokes.began()` / `gesture.begin()`，组件卸载的清理函数也调同一对，两个入口都先于任何用例读它们就把状态摁回起点，漏不出去。

真正漏的是 `document.getSelection()`。RTL 的 `cleanup()` 卸的是渲染树，选区挂在 document 上，不挂在树上，卸载动不了它。一个用例选中文字之后没有让这次手势收走选区（划词只是拖拽中间态，被这次 stroke 用掉才会清），选区就原样留在 document 上；下一个用例开局面对的是它，不是空选区。

两处把它当闸读：

- `chat.tsx:379`，点击收尾时判断这一下是不是划词的收尾：`if (sel && !sel.isCollapsed) return;`
- 那个 stylus 用例自己：`expect(document.getSelection()?.isCollapsed).toBe(true)`

漏出来的选区不是 collapsed，两处各撞一次，撞哪个由 `--seed` 把漏选区的用例排到谁前面决定——同一个文件在不同 seed 下才会红在两个不相干的用例上。

这份文件里其余的 document 级状态不背这个锅：`SourcesPage.tsx`、`CallBubble.tsx`、`PenToolbar.tsx`、`AnnotationPopup.tsx` 也在 `document.addEventListener('pointerdown', …, true)`，但都配在 `useEffect` 里，返回的清理函数在组件卸载时把监听器摘掉——卸载正是 `cleanup()` 干的事，所以这条不漏。选区没有对应的"卸载"，没人替它清。

## 解法

`afterEach` 在 `cleanup()` 之后多清一步：

```ts
afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
});
```

`chat.tsx` 没有改（commit 21a988d）。

## 复现

去掉这一步，只留 `afterEach(cleanup)`：`--seed=1` 挂在 stylus 用例，`Received: false`；`--seed=4` 挂在另一个用例，`Received: []`；`--seed=2`、`--seed=3` 仍绿。补回这一步，四个 seed 都绿。

## 这条之外

选区不是唯一一种"属于 document 而不属于树"的状态，焦点、滚动位置、`document.title`、挂在 `document`/`window` 上的监听器都是同一类。这份代码库里滚动位置都挂在某个元素的 `scrollTop` 上，元素随树一起被卸载，不共享这个问题；没有代码写 `document.title`；`document` 级监听器（上面四个组件）都配在 effect 清理里，卸载即摘除。目前踩到的、真的跨用例活下来的，只有 selection 这一种。

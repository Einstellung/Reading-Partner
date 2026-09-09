# 关着的 shadow root，从里往外是通的

## 现象

foliate 的 `<foliate-view>` 和 `<foliate-paginator>` 都是 `attachShadow({ mode: 'closed' })`。父页拿不到 `shadowRoot`，`querySelector` 穿不进去，`::part()` 也只转发到中间那一层。要量「滚动模式下到底是谁在滚」「正文 iframe 的 `pointer-events` 生效没有」这类问题，看起来只能改 vendor 的源码。

不用。正文 iframe 的 `contentDocument` 是从公开属性拿到的（`renderer.getContents()[0].doc`），而从那个文档里的任何一个节点出发，`parentElement` 一路往上是不拦的：

```js
const frame = contents[0].doc.defaultView.frameElement  // 已经在 shadow 里了
const container = frame.parentElement.parentElement      // #container，closed shadow 里的元素
container.scrollHeight   // 72698
```

`mode: 'closed'` 挡的只有「从外面拿到 shadowRoot 引用」这一条路。手里已经有一个里面的节点，整棵树就都是可达的，读写都行。

## 原因

`closed` 的定义是宿主元素的 `shadowRoot` 属性返回 `null`，不是节点之间的链接被切断。`Node.parentElement` 从来不看 shadow 的模式；`frameElement` 也照常返回宿主里的那个 iframe。事件那边是对称的：composed 的事件跨得出去（`target` 被重定向成宿主），非 composed 的出不去——实测同一个 `#container` 上派发，`composed: true` 父页收到 1 次、`composed: false` 收到 0 次。

## 解法

量 vendor 里 shadow DOM 的行为，入口找一个公开 API 返回的内部节点，然后往上走。foliate 这边就是 `renderer.getContents()[0].doc`。

顺带两条量的时候容易骗自己的：

- 挑够长的一节。EPUB 第一节常常是书名页，实测只有 182px 高，`#container` 的 `scrollHeight` 和 `clientHeight` 一样大，看起来像「不能滚」。跳进正文那一章再量，iframe 高 72602px、容器 `scrollHeight` 72698 对 `clientHeight` 860，才看得出滚动的是父页那一侧的 `#container` 而不是 iframe 自己。
- 派发合成事件验冒泡要显式写 `composed: true`，真实的 UA 指针事件本来就是 composed 的，忘了写会把「跨不出 shadow」当成结论。

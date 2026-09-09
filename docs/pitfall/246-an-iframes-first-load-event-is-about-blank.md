# iframe 插进 DOM 就先发一次 `load`，那是 about:blank，不是你给的 src

## 现象

量「blob: 的 iframe 到底能不能加载」，探针是这样写的：

```js
frame.addEventListener('load', () => resolve('load'))
document.body.append(frame)
frame.src = blobUrl
```

第一次跑就"通过"了：`load` 在 4ms 后到，`contentDocument` 可读。但同一次结果里 `documentURI` 是 `about:blank`，`body.textContent` 是空的，注入的 CSS、图、字体一个都没有——navigation 其实压根没发生。

## 原因

把 iframe 插进文档，WebKit 立刻给它的初始 about:blank 文档发一个 `load`，早于对 `src` 的取。所以「等第一个 load」等到的是这一个，跟 src 有没有成功毫无关系。

坑 99 说得很清楚：Tauri 的 `on_navigation` 取消一个子框架导航是完全静默的，没有 error 事件、没有 CSP 违规、控制台一行都没有。加上这个 about:blank 的 load，一次被取消的导航看起来和一次成功的导航一模一样——探针会报绿。

## 解法

load 事件里先看 `frame.contentDocument?.documentURI`，还是 `about:blank` 就当没发生，继续等；导航真没成，就让它超时。跨源读不到 documentURI 时抛异常，那反而证明导航成了。

判「导航成功」永远要看落地的文档，不看事件。

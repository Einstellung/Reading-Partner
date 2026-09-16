# 324 模拟器里另一个开着 dev server 页面的标签会分走 sim bridge 的 eval

## 现象

iPhone 模拟器上驱动手机重排视图：`ios-sim.sh swipe` 之后 `eval` 读到的 scrollTop 有时跟着动、有时是 0；`press` 之后 `eval` 读到 `saved: 0`、事件记录空，`native` 也没有系统选区条，但截图上手指按过的词一个个都画着高亮，再截一张又多了一个。`eval` 里装的事件监听器、`localStorage` 里的标注，隔一次调用就"没了"。

## 原因

sim bridge 的 `/poll` 是长轮询，谁先接到就谁执行；bridge 只认"同源页面"，不认"哪一个页面"。模拟器的 Safari 里留着一个上一轮分享验证时打开的 `localhost:1420` 标签，它也加载了同一个 smoke 页面、也连着 bridge。触摸落在前台的 app 上，`eval` 却在 app 和 Safari 标签之间轮流执行——读到"干净"状态的那一次跑在 Safari 里。

## 解法

驱动之前先问一句 `!!window.__TAURI_INTERNALS__`，连问几次；答 false 的那次把那个页面送走（`location.href = "about:blank"`），直到连续几次都答 true。再读数就全是 app 的了：长按 0.9 秒 → `pointerdown`、960 ms 后 `pointerup`、没有 `pointercancel`，落一条单词高亮；点它 → `onSelect` 带那个 id。

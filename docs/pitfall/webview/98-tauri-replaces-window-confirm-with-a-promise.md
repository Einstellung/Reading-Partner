# Tauri 把 `window.confirm` 换成了返回 Promise 的版本

## 现象

书库里点主题行上的 Delete，主题立刻没了。没有确认框，也没有报错。代码写的是：

```ts
if (!window.confirm(`Delete topic "${t.name}"? Files stay on disk.`)) return;
await deleteTopic(t.id);
```

浏览器里跑同一份代码，确认框正常，取消也真的取消。iPad 上这条是整轮真机驱动里唯一一条运行时错误：控制台留下一条没人接的 rejection，`Command plugin:dialog|confirm not allowed by ACL`。

## 原因

两层叠在一起。

`tauri-plugin-dialog` 注册时往每个 webview 注入一段 init 脚本（`src/init-iife.js`），把两个全局函数换掉：

```js
window.alert = function (m) { invoke("plugin:dialog|message", { message: m.toString() }) };
window.confirm = async function (m) { return await invoke("plugin:dialog|confirm", { message: m.toString() }) };
```

换过之后 `window.confirm(...)` 的返回值是 Promise，Promise 恒为真值，`!promise` 恒为 false，早退分支永远不走。类型上也看不出来：`lib.dom.d.ts` 里 `confirm` 的返回类型仍然是 `boolean`，`tsc` 全绿。

而那次 invoke 又被 ACL 拒了。`src-tauri/capabilities/default.json` 里只有 `dialog:default` 和 `dialog:allow-open`（为了文件选择器），`dialog:default` 不含 `allow-confirm`。invoke 失败 → Promise reject → 没有 `await`，也就没有 catch，只剩一条未处理的 rejection。删除照跑。

## 解法

不修 `window.confirm` 那条路，破坏性确认一律用项目已有的 `ui/alert-dialog.tsx`（`library/DeleteTopicButton.tsx`、`chat/DeleteThreadButton.tsx`）。原生 confirm 在 Tauri 里要过 ACL、在 iOS 上样式和安全区不受控；AlertDialog 走 `ui/overlay.tsx` 那套，安全区、滚动锁、44px 命中区都已经验过。

护栏是 `tests/ui/components/destructive-confirm.test.ts`：`src/` 下出现 `window.confirm` / `window.alert` 就红。

同族的还有 `window.alert`：它是 fire-and-forget，缺 `dialog:allow-message` 时同样只留一条 rejection，什么都不显示。项目里没有用到。

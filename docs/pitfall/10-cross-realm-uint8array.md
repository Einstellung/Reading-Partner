# iframe 跨 realm 的 Uint8Array instanceof

现象：父窗口把文件字节直接传给 iframe 里的 createView，引擎内部 instanceof 检查失败，加载不了。

原因：父窗口和 iframe 是两个 JS realm，各有一套全局构造器，父 realm 的 Uint8Array 实例在 iframe realm 里 `instanceof Uint8Array` 为 false。epub.js 对 ArrayBuffer 也有同样问题（reader 自己的 index.web.js 里就有修补）。

解法：传前用 iframe realm 的构造器重包一层：

```js
const buf = new iframe.contentWindow.Uint8Array(arrayBuffer);
```

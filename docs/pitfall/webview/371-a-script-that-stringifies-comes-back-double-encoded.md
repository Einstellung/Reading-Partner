# 页内脚本的值经 JSON 往返，脚本自己再 stringify 就是两层

现象：`fetch_page_via_webview` 传脚本 `JSON.stringify(Array.from(document.querySelectorAll("a.iusc")).slice(0,3).map(a => a.getAttribute("m")))`，拿回的 `result` 不是数组而是一个字符串，里面才是 `["{\"murl\":…}", …]`；数组元素本身又是 JSON 字符串。三层。

原因：桥只能传字符串（`run_javascript` 的完成值），所以宿主在页内包了一层 `JSON.stringify`，Rust 侧 parse 回来。脚本自己已经 stringify 过，就多包了一层。第三层是 Bing 自己的：`a.iusc` 的 `m` 属性存的是一段 JSON（`murl` 原图、`turl` 缩略图、`purl` 来源页、`t` 标题）。

解法：脚本直接给值，不要自己 `JSON.stringify`——上面那条写成 `Array.from(...).map(a => a.getAttribute("m"))`，`result` 就是字符串数组，每个元素照样要 `JSON.parse` 一次，因为那是站点自己的编码。脚本抛错不算失败：`result` 是 null，错误进 `detail`，`status` 仍是 `ok`（实测 `(() => { throw new Error("boom"); })()` 回 `detail: "the script failed: boom"`）。

# Bing 图片搜索给 curl 的是结构正确、内容无关的假结果

## 现象

`https://www.bing.com/images/search?q=<词>&qft=+filterui:photo-photo&form=IRFLTR` 用 curl 加桌面 Chrome 的 User-Agent 取，2026-09-21 实测：

- `q=mapo%20tofu`：200，`<title>mapo tofu - Search Images</title>`，35 个 `a.iusc` 锚点，每个都带完整的 `m` JSON，解析出来全是 funny cat memes。
- `q=mapo+tofu`：200，同样的标题，只有 1 个锚点，是个安卓记事本应用的截图。
- `q=shakshuka`：200，12 个锚点，是真的 shakshuka。

同一个查询换个空格编码结果就变，返回码、标题和 DOM 结构全程正确，没有验证码页也没有 429。

## 原因

反爬按请求特征（cookie、TLS 指纹、这个 IP 的历史）判成脚本之后，不拒绝，改发一份缓存里的通用结果。页面结构不变是故意的：解析器看不出区别，只有人能看出图不对。

## 解法

不用 fetch/curl 取，在应用自己的隐藏 webview 里开页面——真浏览器、真会话、真 cookie。解析放在页内脚本里做（取前十个 `a.iusc` 的 `m` 属性），HTML 不用带回来。

派生的两条：一是解析器不能拿 curl 的响应当验收标准，只能验形状（`a.iusc`、`m` 里的 `murl`/`purl`/`turl`），内容对不对只能真机看；二是留一份剥过的响应当 fixture（`tests/info/dinner/fixtures/bing-images-shakshuka.html`），抓的时候记下是哪次、哪个词。

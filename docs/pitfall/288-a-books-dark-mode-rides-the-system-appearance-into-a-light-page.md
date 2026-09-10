# 288 书自带的深色模式跟着系统外观走，落在浅色纸上

## 现象

用户 iPad 上，EPUB 正文入夜后变得几乎看不见：浅灰的字浮在浅色纸上，图还是正常的。早上再看又好了。app 没有深色模式，纸从始至终是同一张浅色纸。

## 原因

iPad 到日落自动切系统深色外观，WKWebView 的 `prefers-color-scheme` 跟着变。书自己的 CSS 里有 `@media (prefers-color-scheme: dark)`，规则是给黑底写的：正文改成浅灰、背景改成黑。背景那条被卡片挡住不生效，字色那条生效，于是浅灰字配浅色纸。图是位图，不受 CSS 影响，所以只有字出问题。

## 解法

`css-sanitize.ts` 把条件含 `prefers-color-scheme` 的 `@media` 块整个丢掉，dark 和 light 都丢：书的无条件规则本来就是浅色那套，light 分支没有额外信息。块解析器递归下去，`@supports` 里套的那层也一样丢。

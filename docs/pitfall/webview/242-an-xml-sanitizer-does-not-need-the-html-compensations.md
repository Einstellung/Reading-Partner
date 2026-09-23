# XHTML 清洗器照抄 HTML 那套补偿，反而不稳定

## 现象

EPUB 的 spine 文档清洗器照 `src/info/extract/sanitize.ts` 的经验，把坑 127 那条 `<pre>` 补偿也抄了过来：输出的第一个字符是 LF 就多写一个 LF。`sanitize(sanitize(x)) === sanitize(x)` 立刻红，每过一趟多一个换行。

```
<pre>

code</pre>
```

## 原因

坑 127 那条补偿是给 HTML 树构建器写的：它规定 `<pre>` 起始标签后紧跟的那个 LF 直接丢掉，所以写回去要多补一个。XHTML 清洗器先用 `application/xhtml+xml` 解，输出也是良构 XML，回程那趟还是走 XML 解析器——XML 没有这条规则，补的那个换行没人吃。

同一条链上另外三类（scope boundary 起始标签关掉外层元素、foster parenting）也一样：那是树构建器的行为，XML 解析器没有。所以 XHTML 这条路不需要坑 127 的重解析循环，也不该照抄。

要保留的只有一条：文本里的字面 CR 仍要写成 `&#13;`。XML 的输入预处理同样把源码里的 CR 换成 LF。

## 解法

判据是"回程那趟用的是哪个解析器"，不是"输入长得像 HTML 吗"。清洗器输出良构 XML，就按 XML 的规则算稳定性。不良构的书走 `text/html` 兜底解析进来，但写出去的仍是良构 XML，所以第二趟也是 XML——补偿一条都不需要。

顺带：命名空间声明必须自己在固定位置用固定前缀写（`xmlns:epub`、`xmlns:xlink` 一律写在 `<html>` 上），不能让 `XMLSerializer` 去生成——它会重命名成 `ns1`、`ns2`，编号在两趟之间会变。

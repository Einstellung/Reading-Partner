# 按住一个汉字，选中整行

现象：PDF 上手指按住中文里的一个字，选中的是整行（实测 17 个字），拖动时终点也扩到行头或行尾；行间没有 PDFium 生成的换行符时扩到整段。英文正常。

原因：`finger-select.ts` 的 `wordAround` 直接用 selection 插件的 `expandToWordBoundary`，它只在字形 flags 为 1（空格）和 2（PDFium 生成的换行）处断词。字形几何里没有字符，分不出哪些字是不带空格的文字，无空格的 CJK 一整行就是一个词。EPUB 那边的 `epub/word.ts` 一直按单字处理，PDF 这边没有。

解法：判断「不带空格的文字」的正则抽到 `src/reading/words/unspaced.ts`，EPUB 和 PDF 共用。`wordAround(geo, at, text)` 多收这页的文本：按住的字是 CJK 就只选它；英文词以空格为界，再在两头碰到 CJK 字时收住（「AI的历史」按 A 得 AI）。文本在 `pdf-select.ts` 里按页读一次缓存：`wordsAt`（按下就调，长按计时期间）发起读取，`begin` 时多半已经到了；没到就先按空格选，文本到了再从按住的字形和拖到的字形重算。夹具 `tests/reading/engine/cjk-lines.pdf`，测试 `pdf-lines.test.ts`。

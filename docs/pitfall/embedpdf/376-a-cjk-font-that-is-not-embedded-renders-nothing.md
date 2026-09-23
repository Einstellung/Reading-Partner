# 没嵌字体的中文 PDF 一个字都不出，也不报错

现象：一份用 `/STSong-Light` + `/UniGB-UCS2-H`（Adobe-GB1 标准 CID 字体，不嵌字体文件）排的中文 PDF，在 iPhone 17 模拟器的阅读引擎里打开，页面是白的：同一行里的 ASCII 片段（`STSong-Light`、`PDFium` 这类）照常画出来，所有汉字消失。不是豆腐块，不是问号，是那几个字所占的位置直接空着。`openDocumentBuffer` 正常 resolve，`pageCount` 对，`__spike.error` 是 null，控制台没有任何一行。同一份文件在 Linux 上用 poppler（`pdftoppm`）渲染，汉字齐全——因为 poppler 会去系统里找一个替代字体。

原因：引擎是以 `fontFallback: null` 创建的（`src/reading/engine/engine-singleton.ts` 两条路径都传），而 PDFium 的 wasm 包里不带任何 CJK 字体（4.6MB，一份 CJK 字体就不止这个数）。`fontFallback` 不是开关而是一份清单：`{ fonts: { [FontCharset.GB2312]: 'NotoSansSC-Regular.otf' }, fontLoader }`，字体文件要宿主自己备、自己喂。清单是 null，PDFium 找不到字形就跳过这个字，不画也不抱怨。

嵌了字体的中文 PDF 不受影响：同一轮里一份把 Noto Serif CJK 子集嵌进去的 CIDFontType0 文档，简体繁体都正常，字形正确。

解法：要支持不嵌字体的中文书，得给 `fontFallback` 挂一份 CJK 字体并实现 `fontLoader`，代价是包里多几 MB（可以按需 fetch）。在那之前，摄入一本 PDF 时能提前判出来——`pdffonts` 那一栏的 `emb` 为 no 且 charset 是 GB1/CNS1/Japan1/Korea1——与其让用户打开一页白纸，不如当场说这本书缺字体。

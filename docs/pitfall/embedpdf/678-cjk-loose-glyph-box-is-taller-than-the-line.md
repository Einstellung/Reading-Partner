# 中文 PDF 划线：高亮叠成方块，下划线落到下一行；按住标点和「一」起不了选

现象：用 Noto Sans/Serif CJK 排的 PDF，划几行高亮，每行的黄色盖住上下两行，叠成一整块；下划线画在下一行字的中间。手指按住「，。：」或「一」没反应，旁边的字照常能选。

原因：PDFium 给每个字两只框。loose 框（`FPDFText_GetLooseCharBox`）是字体整格的上升到下降，CJK 字体这一格很高：实测 14pt 正文行距 27，loose 框高 53，墨迹（tight 框）只有 17。selection 插件的 `rectsWithinSlice` 用 loose 框拼每行的矩形，于是每行矩形盖住两行，Underline 组件把线画在矩形底边。命中又是反过来：`glyphAt(geo, pt, 0)` 只认 tight 框精确命中，逗号的墨迹是基线上一个点、「一」的墨迹高 1，按在行中线上落不进去（zh 夹具 128 个字里 13 个起不了选）。英文字体 loose 框也略高于行距（DejaVu Serif 12pt 高 23、行距 19），只是叠得少看不出来。

解法：一行的框横向用 loose（相邻字首尾相接，跟插件的拆行并行一致），竖向用这一行的墨迹带：run 里所有字 tight 框的并集，上下各放 15%，但不超过到上下邻行墨迹的一半，也不超出 loose 格（`finger-select.ts` 的 `lineBands`/`lineRects`）。墨迹带太薄（整个 run 只有一个破折号）时撑到本页常见行高。手指的命中也用它：横向 loose x、竖向本行墨迹带（`glyphUnder`）。笔和鼠标那条路走 annotation 插件，插件优先用工具上的 `selectionHandler`，`markup-select.ts` 照插件原样写标注、只把 `segmentRects` 换成同一套行框，经 `markupToolOverrides` 挂到 highlight 和 underline 上。拖选过程中插件自己画的蓝色选区仍是 loose 框。

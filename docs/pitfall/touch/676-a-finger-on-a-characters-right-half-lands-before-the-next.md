# 676 手指按在字右半边，caret 落到下一个字前

## 现象

EPUB 中文里长按一个字的右半边，选中的是下一个字；拖选的终点落在字右半边多带一个字，起点落在右半边少一个字。WebKitGTK 实测 77 个字各按左 1/4 和右 3/4：左边全对，右边错 73 个（剩 4 个是行尾字）。滚动和多栏一样，手机流式、手机翻页、iPad 页卡片的手指选区和笔起笔都中。

## 原因

`caret.ts` 的二分（`nearestOffset`）和原生 `caretRangeFromPoint` 都返回离点最近的字间边界。右半边离右边界更近，caret 落在这个字之后；`word.ts` 的 `wordOf` 把边界后面那个字当成按住的字，中文一字一词，于是取到下一个字。英文词长，按在词尾字母右半边也落在词内或词尾，很少露馅。

## 解法

`caret.ts` 加 `charUnder(caret, x, y)`：量 offset-1 那个字的 glyph 框，点落在它横向范围内、竖向在同一行（上下放宽半个字高算行距），就退一格。手指路径的 caret 一律过它：`flow-marks.ts` 的 `caretAt`/`caretIn`、`paged-view.ts` 的 `strokeCaret`、`mark-layer.ts` 的 `caretOn`。笔起笔用 `charSpanUnder` 取笔下那个字的两侧，`strokeRange` 保证无论往哪拖都含它；笔的终点仍取最近边界，过了字中线就带上那个字。

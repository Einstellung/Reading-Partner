# 282 书自己的页底色只铺满版心，一张纸是两个颜色

## 现象

量 EPUB 纸面颜色，取整张卡片的众数得 `#f4edda`（55.7%），取页边距得 `#f6efdc`（22.5%）。开纸色之前同样分两块，`#fdfdfd` 和 `#ffffff`。两个数都不是错的，按哪个都能得出「纸色没生效」或者「生效了」。

## 原因

书的 `<html>` 是挂在 `.rp-columns` 里的一个块，那个盒子是版心大小，不是纸的大小。它的 `background` 铺到自己盒子为止，纸的页边距露的是卡片自己的白。三本样书里有一本写了 `html { line-height: 1.2; font-family: Georgia, serif; color: #1a1a1a; background-color: #fdfdfd }`。

## 解法

量纸面颜色一律取页边距，别取版心，也别取整张卡片的众数。

书写深色底时得到的就是「纸色页边 + 深色版心」，正文字被同一道 multiply 乘暖（`#eeeeee` → `#e5dfcd`）仍读得出。消毒器不动书的背景色，真遇到一本这样的书再决定要不要在 `css-sanitize.ts` 里丢掉 `html`/`body` 的背景。

# 274 一张页卡片的 DOM 里是整章，不是一页

## 现象

想在壳里核对「第 31 页上有什么字」，从卡片取文本，两条路都给错的东西：

- `card.shadowRoot.querySelector("body").innerText` 给的是整个 spine 文档的正文，从章首开始，和这张卡片显示的那一列没关系。
- `.rp-clip` 的 `textContent` 里还夹着一大段 `html, body, div, span, applet, object, iframe, h1, h2 …`，那是书自带的 `<style>` 的 CSS 源码。

照第一条截出来的「引文」拿去当 `[p.31 "…"]` 的引文，跳页对、高亮画不出来。

## 原因

页卡片挂的是整份消毒后的 spine 文档（docs/63）：`.rp-columns` 用 multicol 把整章排成列，`translateX(-k×480)` 把第 k 列推到版心里，`.rp-clip` 的 `overflow: hidden` 把别的列裁掉。裁掉的列还在 DOM 里，只是看不见——`innerText` 不看 `overflow`。`<style>` 是 `<html>` 原样克隆的一部分，`textContent` 不区分它和正文。

## 解法

页的文本只从分页表来：`blocks[i].charOffset`/`endOffset` 去 `doc.text.text` 里切，或者直接读 `Fulltext.pages[i]`。要在卡片树上定位一段文本，走 `reader-view.ts` 里引文那条路——先在抽取文本里找偏移，再用 `extractDocumentText(card.mounted.root)` + `runAt` 按同一偏移取 Range，不要从卡片的 `innerText` 反推。

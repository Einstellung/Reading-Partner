# 量尺交回的节点是克隆树的，拿去摄入树上查偏移全是 0

## 现象

webview 里排出来的分页表页数对（73 页），CFI 也对，但每页的 `charOffset` 几乎全是 0：`blockNumberAt` 把书 30% 处的引文算到最后一页，`Fulltext.pages[]` 第一页是整章、其余全空。单测全绿——测试用的 `characterRuler` 直接把摄入树的节点交回来。

## 原因

`page-ruler.ts` 把 spine 文档 `importNode` 进离屏卡片再量，交回的 `PagePoint.node` 是克隆树的节点。`offsetOfPoint` 靠 `Map<Node, TextRun>` 按节点身份查偏移，克隆节点查不到，退到父元素也查不到，最后返回 0。`pointSteps` 只看节点在兄弟里的序号，克隆树和原树序号一样，所以 CFI 是对的，偏移是错的，两者不一致又没有任何东西报错。

## 解法

`paginate.ts` 的 `cutsOf` 不再直接拿量尺的节点取偏移：先 `pointSteps` 取 CFI 步，再 `resolvePoint` 在摄入树上解析回节点，然后才 `offsetOfPoint`。`tests/reading/epub/pages.test.ts` 有一条用克隆树节点的量尺，断言表和原树量尺的完全一致。

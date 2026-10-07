# workshop 与 bindery

> 2026-10-07 定案。上游：[67](../reading/67-HTML文档.md) 是网页落成 EPUB 文档，[84](../info/84-X链接摄入.md) 是 X 链接摄入，[78](./78-分享.md) 的 `src/intake/` 是收件和分发，[61](../soul/61-palace与desk.md) 是登记表的做法。

---

## workshop

`src/workshop/` 放把原始材料加工成可用材料的能力，capability 层，登记进 `tests/layering.test.ts` 的 LAYER 表，父目录和每个子目录各一行，做法同 `memory/`。按它对材料做什么来分，不按谁来用它分：秘书处、阅读、三餐都是调用方，workshop 不认识它们，也不 import 任何领域。兄弟之间可以互相调用，依赖不成环。

第一批两个：

- `workshop/extract`：网页到正文。由 `info/extract` 整体下移，`read-page-tool.ts` 是 agent 工具，留在 info。
- `workshop/bindery`：材料到 EPUB。

以后的兄弟：音视频转文字（[56](../info/56-YouTube访谈接入.md) 的字幕、端侧听写）、图片和扫描件 OCR、翻译里不依赖阅读器的那部分。`fulltext` 暂不动。

## bindery

交进来一份材料，交出去一个 EPUB 和它的元信息。不决定放进哪个 topic，不写书库。

分三段：

1. 适配器把材料整理成可读稿：标题、作者、时间、原链接、语言，若干段按顺序排的干净 HTML，加图片。bindery 自带通用适配器：网页、原始 HTML、纯文本、Markdown。认得具体网站的适配器由领域注册进来，bindery 不认识任何一个站：X 由 info 注册（[84](../info/84-X链接摄入.md)），arXiv 这类文献库走 `info/sources/plugins`。
2. 质量关：正文为空、太短、或者是登录墙的提示，就不往下走，交回原因。
3. 生成 EPUB：现在 `reading/epub/file` 里的生成器下移到这里，扩展成能接多段（thread、合订本）。只有一段时，产出的字节和今天一样，书架上已有的文章不会因为重建多出一份。

## 和领域的分工

入口收到的东西经 `intake` 分到领域。领域负责编排：调 bindery 拿到 EPUB，决定放进哪个 topic、挂在哪本书上，做全文索引。归 topic 用 `memory/filing`。reading 的 `ingest_url` 改成走 bindery，质量关没过就回一句取不到和原因，不再落成空书。

## 顺序

1. 纯搬家：`git mv` 加改 import，零逻辑改动。`info/extract` 下移到 `workshop/extract`；生成 EPUB 用到的文件（生成器和它依赖的打包、清洗、目录、zip）以及网页适配要用的页面元信息、取图下移到 `workshop/bindery`。reading 读 EPUB 时用的清洗和 zip 改从 bindery 引用。
2. 可读稿、通用适配器、站点适配器登记表、质量关、多段生成，`ingest_url` 接上。
3. 站点适配器：X 等 [84](../info/84-X链接摄入.md) 实测完再做，arXiv abs 页取 PDF 和真实标题。
4. 简报的 Keep 和备课面板的加链接改走 bindery，收藏存成 EPUB。

   已做（2026-10-07）。Keep 把简报手里的正文（HTML，没有就纯文本）交给 bindery，不重取页面，只取图；产出的 EPUB 以 `kind: "article"` 入库，归进收藏记录所在的 topic（现在固定 Brief），记录上新增可选字段 `documentHash` 指向它（`reading/ingest/keep.ts`）。质量关没过、构建失败或正文为空，只留记录。只有摘要的正文照样过关就建，`summaryOnly` 留在记录上。记录和文档算一件东西：文章对话的 Apply 和删 topic 的 reassign 把文档一起搬（`reading/saved/kept-document.ts`），取消收下把文档从记录的 topic 拿掉、没有别处引用就删（`reading/delete/unkeep.ts`），从 topic 拿掉文档那一行也取消收下。书架上有文档就不再列记录那一行；手机 Saved 列表点开时文档在本机就进阅读器，不在就打开快照。再收同一篇复用已有文档，摘要换成全文时建新的、旧的退掉。存量记录不迁移，没有 `documentHash` 的照旧走 `SavedArticleView`。备课面板加链接的网页改走 bindery 的 web 适配器和质量关（`readMaterial`，只读不建），`reading/sources/article.ts` 的正则抽取删了。

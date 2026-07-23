# Reading-Partner

## 写作规范（文档和对话回复都适用）

- 直接写结论和做法。不写被否掉的方案，不写理由链。
- 不用 emoji。
- 不靠加粗造金句，不写口号，不用排比和对仗。
- 不写元评论："这很重要"、"这是最大的收获"、"值得注意的是"、"我认为这个不对称是故意的"。
- 短。一句话能说完就不写一段。同一件事不说第二遍。
- 结构不要过度。能用一段平铺直叙的，不拆成四个小标题。

## 语言

- 本项目源码公开（source-available，PolyForm-NC）：README、commit message、代码注释、代码内标识符和 UI 文案一律英文。
- `docs/` 下的设计共识文档用中文（写给项目发起人自己看的）。
- 和用户的对话用中文。

## 项目

AI 陪读软件。设计共识在 `docs/`。阅读引擎用 EmbedPDF（PDFium WASM，`src/reader-embedpdf/` 适配层；pdfium.wasm 自托管，`bun run wasm` 从 npm 包拷出）。

## 代码组织

- src 下任何文件夹超过约 15 个文件就该切子域。搬家 commit 纯移动（`git mv` 保历史）加改 import，零逻辑改动。

## 坑

踩到"实测才知道的意外行为"必须记进 `docs/pitfall/`：一坑一文件（现象/原因/解法），并加进该目录 README 的索引。写代码碰引擎/Tauri 之前先扫一遍这个目录。

## 工具链

- 包管理器用 bun。

- 样式:Tailwind v4(只引 utilities,不引 preflight),UI 一律用 Tailwind utility class。

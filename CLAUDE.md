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

AI 陪读软件。设计共识在 `docs/`。阅读引擎用 EmbedPDF（PDFium WASM，`src/reading/engine/` 适配层；pdfium.wasm 自托管，`bun run wasm` 从 npm 包拷出）。

## 代码组织

- src 下任何文件夹超过约 15 个文件就该切子域。搬家 commit 纯移动（`git mv` 保历史）加改 import，零逻辑改动。
- 分层：platform（`platform/app`/`platform/sync`，`platform/app` 不 import 任何别的目录）→ capability（`ai`/`ai/voice`/`budget`/`fulltext`，headless，只被领域调用，绝不反向 import 领域；`budget` 不 import `ai`，因为发送路径要能 import 它）→ 领域（`reading` 及其子目录 `engine`/`prep`/`papers`/`notes`/`figures`/`slides`/`sources`、`info` 及其子目录 `briefing`/`companion`/`extract`/`sources`、`memory`，互相可用但目录级依赖图必须无环）→ `ui/components` → `App.tsx` → 入口（`main.tsx`/`smoke`）。领域的编排代码放自己的领域目录，不要塞进 capability。规则由 `tests/layering.test.ts` 强制，新增目录（顶层的，或分组目录下的）必须在那里的 LAYER 表里登记。两个目录互相 import 就是环，不许往更深一层藏——按"谁不认识谁"重新切，把被依赖的那半提到同级并登记。
- `.tsx` 只放渲染和事件绑定。不依赖 React 的逻辑放 `.ts` 并配单测。手机形态将来换掉的是 `.tsx` 那一层，`.ts` 不动。
- 适配触摸和小屏用 utility 变体（`coarse:` / `can-hover:` / 断点），不按操作系统分叉组件。需要分形态时分的是外壳（phone / tablet+desktop），判据是宽度和指针类型，叶子组件共用一套。

## 坑

踩到"实测才知道的意外行为"必须记进 `docs/pitfall/`：一坑一文件（现象/原因/解法），并加进 README 对应的一组。动引擎、触摸、Tauri、网络、存储、iOS 打包前，按 README 顶部的对照表只读相关那一两组，不通读。

## 工具链

- 包管理器用 bun。

- 样式:Tailwind v4(theme + preflight + utilities,拆开 import,layer 顺序在 `src/styles.css` 顶部显式声明,见坑 75),UI 一律用 Tailwind utility class。`styles.css` 只放全局基线。

- 原语用 shadcn/ui（`components.json`，`bunx shadcn@latest add <component>` 写进 `src/ui/components/ui/`）。设计 token 在 `styles.css` 的 `:root` + `@theme inline`，取值映射到现有配色，见 `docs/30`。`@/` 别名指向 `src/`，只给 shadcn 生成的文件用；应用代码一律相对路径 import。按钮尺寸和 44px 触摸目标写在 `ui/button.tsx` 的变体表里，调用点不要各自补 `coarse:`。

- Radix 浮层（Portal 到 `<body>` 的那些）一律从 `ui/overlay.tsx` 出：`OVERLAY_SAFE` 给安全区（`cn()` 拼进 className，不要拼字符串），children 里放 `<OverlayLayer />` 登记层级。做法和理由见 `docs/30` 的「浮层的规矩」。

## 发布

说「构建」就是补丁号 +1 再发 TestFlight，不用问。版本号在 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 四处，一起改。主次版本号由项目发起人定。构建号是 workflow run number，不用管。

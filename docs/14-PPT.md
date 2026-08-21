# PPT：Reading-Partner

> 本文记录 slides（PPT）的设计共识，与 [00](./00-项目共识.md)、[02](./02-AI核心与memory设计.md)、[09](./09-学习机模式.md) 同一风格。
>
> 作废 2026-08-19（晚）：笔记那半（原「定位」到「落地：M-note-1」）已作废，产物不是给人读的笔记，见 [09](./09-学习机模式.md) 的「书的备课：章脉络」和 [31](./31-读完之后的梳理与讲.md)。本文只剩 slides。

---

## PPT（slides）共识

2026-07-19 手工实验（用真实笔记做了一版 14 页 deck）后拍板：

- 产物：自包含单 HTML 文件，零外部依赖，浏览器打开即放映。壳（样式、翻页）是固定模板，AI 只产出每页内容片段。
- 单位是"一场 talk"不是"一本书"：选多本已有笔记的书 + 一句 talk 说明（主题、听众），从各书笔记合成一条叙事线。overview 定主线，章节笔记填内容。
- 内容必须是 AI 蒸馏改写，不是笔记摘录（笔记是分析性长段落，直接切句是文字墙）。每章页数按信息密度伸缩；目录型章节用表格不硬压 bullet。
- 图源三层：书内原图（裁剪内嵌 base64）、AI 画的 SVG 示意图、生图 API 插画（可选，设置填 key 才启用，固定 style prompt 保证整场风格统一）。
- 分期：第一期围绕科普书的分享（多本合讲、图少靠生图和 SVG）；学术讲座支持（目录型章节、密集原图）第二期。
- 实验发现的 app 侧 bug 线索：bbox 大面积 null 已修（矢量图 bbox，见 [12](./12-图片讲解.md) 的 2026-07-18）；图索引会漏笔记引用的图（Fig.1 缺失）还没修。

## 落地：M-ppt-1

- 已修 2026-08：入口从 Notes 面板的 Slides 按钮改到讲里的 Deck 按钮（见 [31](./31-读完之后的梳理与讲.md)「PPT」），不再选书、不再写一句 talk 说明——材料和大纲都是这场讲自己的。生成的 deck 用系统浏览器打开（opener 插件，`opener:allow-open-path` 限 `$APPDATA/slides/*`）不变。
- 三段管线 `src/reading/slides/`（同构备课管线，纯逻辑注入式可测，AI 调用在 `live.ts`，看门狗共用 `src/ai/watchdog.ts`）：plan 阶段已改为按这场讲的决定排页（[31](./31-读完之后的梳理与讲.md)「PPT」一节）——先读 `readDeckOutline`，有决定就用 `applyTalkOutline` 把被 Cut 的章去掉、被漏的章补回；本节原描述的"模型一次调用自己拟 deck 大纲"（喂各书章节清单——章号、标题、页码、有没有笔记、笔记前 40 词——overview 有就一起给当主线）只剩什么都没定时的回落路径。`validateDeckPlan` 当场校验 `sourceChapters` 与 `figId` 存在，改动记在该页的 planNotice 上；content 每页一次调用出受限 HTML 片段（蒸馏不摘录，产出后 `sanitizeFragment` 去脚本/外链）；assets 每个插图槽调生图、每个图槽走 app 内裁剪路径；assemble 读盘上的片段与素材注入固定壳模板 `template.ts`，写 `slides/<talkId>-<slug>.html` 并登记 `slides/talks.json`。
- 中间表示落盘（2026-08-05）：一场讲一个目录 `slides/<talkId>/`，`state.json` 是恢复点，每页正文 `slide-NN.html`、素材 `asset-NN.txt` 各一个文件。中断的 running 归回 pending，重进接着跑，done 的页不重跑；重跑粒度三个——一页正文（可带一句指示）、一页素材、重新拼装（不花钱，assemble 退化成纯拼装）。
- 生图可选：OpenAI-Images 异步中继（right.codes 式，`imageGen.ts`），key 存 `credentials.json`（不同步），apiBase/model 存 `settings.json`（无害、同步）；首张成功插画作后续调用的参考图保风格；无 key 则跳过所有插图槽，deck 照出。HTTP scope 已是 `https://*` 通配，无需为 right.codes 加白名单。
- 同步：`slides/` 不入同步范围，落盘之后也不进（`inSyncRange` 默认已排除，测试断言）。`state.json` 单独同步重建不出任何东西——正文片段和 base64 素材才是内容，是几兆的派生数据；只同步索引会让另一台设备看到一个"已完成"而文件不存在的 deck。
- 已知限制：bbox 为 null 的图裁不出来，这一页的素材状态是 missing 并写明原因（不再标 done）；正文失败即整场失败，素材失败只影响该槽；溢出只报不排版——生成时按模板尺寸估算记在该页状态里，放映时壳自己量 `scrollHeight` 在暗场里出提示。

## 后续待定

- 选段改写。
- slides 导出 PDF、主题换肤、单页编辑、演讲者备注。
- 跨章主题式笔记。

*讨论与落地：2026-07-18；PPT 共识：2026-07-19*

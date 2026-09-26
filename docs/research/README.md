# 调研

这里放调研：带来源链接和存疑清单的事实核查，不是设计共识。文件不占 `docs/` 的编号。

调研得出的设计决定写进 `docs/` 的编号文件或 `docs/north-star/`，并链回这里。

- [都市白领买菜渠道调研](./都市白领买菜渠道调研.md)：中美白领买菜的线上线下分布，各零售商的公开数据面，离线购物清单要什么数据。2026-09-17。
- [都市白领饮食核心诉求调研](./都市白领饮食核心诉求调研.md)：中美都市工作人群日常吃饭的真实诉求、实际行为、现有产品的存活与死亡，以及对 north-star/diet.md 的逐条检验。2026-09-17。
- [EmbedPDF-spike结果](./EmbedPDF-spike结果.md)：从 zotero/reader 换到 EmbedPDF 的 spike 实测，对接细节、回调契约和坑清单。2026-07-16。
- [记忆与画像调研](./记忆与画像调研.md)：记忆重做之前的证据底账，外部系统与评测的结论和我们当时的缺口。2026-07-31。
- [思维导图调研](./思维导图调研.md)：梳理之后顺带出思维导图值不值得做，结论是不做成功能。2026-08-06。
- [TTS供应商横评](./TTS供应商横评.md)：TTS 候选清单、价格口径和中文质量证据，选型已定小米，留作结案记录。2026-08-27。
- [饮食规划调研](./饮食规划调研.md)：饮食规划能不能落到生鲜到家和外卖下单，以及营养和菜谱数据源。2026-08-28。
- [dream调研](./dream调研.md)：夜间批处理记忆整理的先例，Letta、Mem0、Zep、Codex 等怎么做。2026-09-01。
- [epub渲染spike](./epub渲染spike.md)：iframe 重排路线在 iOS WKWebView 和 WebKitGTK 上的实测，事件、CSP 和内存；路线已被 docs/64 取代。
- [端侧ASR调研](./端侧ASR调研.md)：桌面按住说话换成本机 sherpa-onnx 跑 SenseVoiceSmall 的资料调研。2026-09-12。
- [食材与菜品图片源调研](./食材与菜品图片源调研.md)：给购物清单每行和每道菜配公开图，TheMealDB 加 Spoonacular 兜底的覆盖实测、条款与落空链条，给 [north-star/diet](../north-star/diet.md) 用。2026-09-20。
- [Jev开源生态调研](./Jev开源生态调研.md)：Jev 发布后五天的开源复刻、独立评测和 TypeSafe 官方口径，供 [north-star/system-one](../north-star/system-one.md) 定接入时机用。2026-09-20。
- [pdfium-on-iphone](./pdfium-on-iphone.md)：现有阅读引擎（EmbedPDF + PDFium WASM）在 iPhone 17 模拟器上的实测，启动、翻页、内存、帧率、字号和渲染正确性。2026-09-22。
- [pdfkit-plugin-route](./pdfkit-plugin-route.md)：手机 PDF 走 iOS 原生 PDFKit 经 Tauri 插件的代价评估，能力表、坐标互认、插件文件清单和两条路对照；路线已关。2026-09-22。
- [pdf-reflow-on-phone](./pdf-reflow-on-phone.md)：把论文正文抽出来在 393pt 屏上重排的可行性探针，四篇样例的对错、映射表代价、arXiv HTML 覆盖率。2026-09-22。
- [pdf-text-extraction-on-iphone](./pdf-text-extraction-on-iphone.md)：`src/fulltext/extract.ts` 的 pdf.js 抽全文在 iPhone 17 模拟器上的实测，15/214/548 页三档的耗时、帧率、worker 和内存峰值；手机课堂正文地基的生死判据。2026-09-22。
- [meal-planning-skills](./meal-planning-skills.md)：互联网上现成的做饭 / 三餐计划 / 采购单类 agent skill、MCP 工具包和菜谱数据资产，按 SKILL.md 生态、其他生态、中文社区、开源备餐软件、数据源五类，末尾列可以拿走的候选。2026-09-22。
- [健身饮食与快手三餐调研](./健身饮食与快手三餐调研.md)：三餐线转向十分钟组装加健身目标后的依据，热量蛋白算法（输入、公式、默认值、回调）、食物数字来源、开场问答、备餐防腻规则、《健身营养全书》的取舍和上架合规。2026-09-23。
- [多室建筑与陪伴类调研](./多室建筑与陪伴类调研.md)：十五个首页画成多室建筑的游戏和应用怎么摆室、画状态、进房，外加 BSide: 林离 和 Whispers from the Star 两个单间陪伴；[77](../info/77-办公室与红盒子.md) 的参考。2026-09-25。

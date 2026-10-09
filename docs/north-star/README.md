# North Star

认定要做、但不在当前规划内的方向。不排期,不影响当前里程碑;等基本盘立住了再回来看。

每个文件记三件事:愿景、为什么现在不做、将来做时已知的事实(带出处)。一事一文件。

基础设施里设计文档定了、代码还没做的也记在这里。

- [epub](./epub.md) — EPUB 支持,方案见 [39](../reading/39-epub支持调研.md)
- [phone-reading](./phone-reading.md) — 手机阅读：碎片时间的续读；还没做的是翻页的跨屏划线、划线附一句话、书里的 pull-to-ask、听、书内搜索等小件
- [observations](./observations.md) — 仍留在北极星的只有主动联想,其余四项已随 M8 转正
- [companion](./companion.md) — 形象与养成:形象是 Lumen([66](../companion/66-Lumen.md)),已落地,长按开语音会话([68](../companion/68-Lumen与盒子的交互.md));逗弄、养成推后;主动说话不推后
- [podcast-video](./podcast-video.md) — 访谈视频:只接 YouTube,播客不做,接法定在 [56](../info/56-YouTube访谈接入.md)
- [diet](./diet.md) — 饮食规划:省事和健康都是硬约束、不腻是区别所在,主件是周计划加购物清单,计划就是记录;第一片([73](../info/73-三餐：周计划、采购单与偏离.md))已在当前发布版里,设置里默认关,手机有三餐屏;六点推送和体重趋势回调还没做
- [telemetry](./telemetry.md) — 匿名使用统计：每天一条平台/机型/版本，无 ID 不存 IP，可强制；后端倾向 Vercel 挂自有域名
- [system-one](./system-one.md) — 系统一判断模型：yes/no、选项、量表出校准概率，端侧推荐的核心；现产品一处不接，触发条件是 concern 影响排序权重要动手的时候（[生态调研](../research/Jev开源生态调研.md)）
- [legion-rest](./legion-rest.md) — legion 派活的地基已落地（[55](../soul/55-legion.md)），剩 session 投影、effort 一等维度、ledger 重放和几处没闭合的验收
- [memory-recycling](./memory-recycling.md) — 记忆的另一半：memory 自己的 garbage marker（回收框架 [80](../platform/80-回收：retention、garbage marker 与 housekeeper.md) 已落）、dream 的欠账与回收两段、concern 的 lapsed 与转正、statement 检索，[48](../soul/48-记忆：观察与statement.md)、[58](../soul/58-蒸馏器与dream.md) 定了，等数据
- [sync-tiers](./sync-tiers.md) — [59](../platform/59-同步：持有清单与裁决.md) 剩档 2 删除推断，翻开前要先补 `retired` 的生产端；删除还有几条竞态和清理没做
- [topic-in-info](./topic-in-info.md) — cable 在三个出口带 topic（[61](../soul/61-palace与desk.md) 第 4 步），desk 那半落了这半没排，`BRIEF_TOPIC_ID` 还是应急版
- [info-bureau](./info-bureau.md) — 情报局的其余机构：专项组、编辑部、A 档源、[65](../info/65-加工手册：常态模型、日更列表、滚雪球与稿.md) 五层，源侧等 [17](../info/17-信息源系统.md) 重做
- [share](./share.md) — 分享出去：info 或书的合集带网站地址传给没装过 app 的人；图片卡片不要服务器，链接要一个上传接口加静态托管；等有网站、装上即用之后再做
- [mobile-platform](./mobile-platform.md) — 移动端平台缺口：Android 识别、语音权限、安全区、真机验证链没接；iOS itms-services OTA 分发未做；latest.json 三平台并发写有竞态
- [soul-conversation-gaps](./soul-conversation-gaps.md) — soul 对话的尾巴：steer 还没接 retell 和 info 回合、图片和答铃不流式、Outline 刷新漏 synced 档、openThread 竞态、threadId 待改名 conversation
- [voice-i18n](./voice-i18n.md) — 语音跟随语言选项：听写语言、STT/TTS、通话与按住说话文案、麦克风权限说明；2026-09-28 从多语言第一轮（[81](../ui/81-多语言.md)）拿掉
- [architecture-audit](./architecture-audit.md) — [37](../platform/37-结构与架构优化.md) 架构审计 C 组长期债：App.tsx 与 ui/components 越线目录、流式驱动三份收拢到两份、docs/38 安全审阅未入库

webview 渲染管子（隐藏 WebviewWindow 当渲染引擎）已经落地并随彭博社源发货，不再是北极星方向；现状和剩下的缺口（SPA 站发现层）记在 [17](../info/17-信息源系统.md)。

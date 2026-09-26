# 设计文档索引

编号全局唯一，新文档取下一个空号，按领域放进对应文件夹。

- [00 项目共识](./00-项目共识.md) — 项目定位、总体共识与否掉的方案

## reading

- [01 交互设计](./reading/01-交互设计.md) — 产品交互定稿与三层记忆模型
- [03 陪读交互-通话模型](./reading/03-陪读交互-通话模型.md) — 陪读的通话隐喻、通道与界面布局
- [09 学习机模式](./reading/09-学习机模式.md) — AI 开车带着共读的第二种关系
- [12 图片讲解](./reading/12-图片讲解.md) — AI 拿论文的图讲解，fig 卡片与看图
- [31 读完之后的梳理与讲](./reading/31-读完之后的梳理与讲.md) — 读完一本书到和 AI 梳理成一场讲
- [39 epub支持调研](./reading/39-epub支持调研.md) — 读代码得出的 EPUB 支持路线
- [41 引文展示](./reading/41-引文展示.md) — 带原话的页码引用怎么显示
- [44 大纲与排练](./reading/44-大纲与排练.md) — 对着大纲讲，AI 在排练里的角色
- [64 epub纸页](./reading/64-epub纸页.md) — EPUB 与 PDF 同为纸页，分页表与字体
- [67 HTML文档](./reading/67-HTML文档.md) — 网页摄入成书内文档与辅助资料
- [70 手机读EPUB](./reading/70-手机读EPUB.md) — 手机上的 EPUB 重排阅读与划线
- [74 手机PDF课堂](./reading/74-手机PDF课堂.md) — 手机打开 PDF 直接进 AI 带读的课堂

## soul

- [02 AI核心与memory设计](./soul/02-AI核心与memory设计.md) — agent 框架选型与 memory 机制
- [05 AI接入备忘](./soul/05-AI接入备忘.md) — pi-ai 接入、OAuth 与流式接口实测
- [25 子agent与上下文隔离](./soul/25-子agent与上下文隔离.md) — legion/subagent 的契约
- [48 记忆：观察与statement](./soul/48-记忆：观察与statement.md) — 观察与 statement 两个记忆仓
- [55 legion](./soul/55-legion.md) — run、调度与按能力指派的 worker 底座
- [58 蒸馏器与dream](./soul/58-蒸馏器与dream.md) — 记忆之上的蒸馏与回收
- [61 palace与desk](./soul/61-palace与desk.md) — palace 与 desk 的定义与登记
- [71 soul](./soul/71-soul.md) — 唯一的 orchestrator：soul
- [72 聊天的可见性与steer](./soul/72-聊天的可见性与steer.md) — 工具流可见性、回执、派工单与 steer
- [75 两档模型](./soul/75-两档模型.md) — 对话档与日常档，任务归档由程序定

## info

- [17 信息源系统](./info/17-信息源系统.md) — 源的描述格式、站点登录与正文抽取
- [21 info收藏与reading打通](./info/21-info收藏与reading打通.md) — info 材料怎么进 reading
- [24 联网搜索](./info/24-联网搜索.md) — 让两边对话能搜互联网
- [33 语音简报](./info/33-语音简报.md) — 语音简报的交互、TTS 选型与实测
- [35 简报漏斗](./info/35-简报漏斗.md) — 采集判断四步漏斗与条目池
- [36 采集端与阅读端](./info/36-采集端与阅读端.md) — PC 采集、移动端消费的分工
- [56 YouTube访谈接入](./info/56-YouTube访谈接入.md) — yt-dlp 取字幕并蒸馏访谈
- [57 登录态浏览器取材与computer-use](./info/57-登录态浏览器取材与computer-use.md) — 登录态浏览器读 X 与 GUI 模型
- [60 info：白宫与Red Boxes](./info/60-info：白宫与Red Boxes.md) — info 管线重做：盒子与秘书
- [63 情报局：研究室、专项组与态势](./info/63-情报局：研究室、专项组与态势.md) — 情报局编制、态势与质量规则
- [65 加工手册：常态模型、日更列表、滚雪球与稿](./info/65-加工手册：常态模型、日更列表、滚雪球与稿.md) — 从条目到稿的加工方法
- [69 源模型：索引、叙事源、用户带来的与快照](./info/69-源模型：索引、叙事源、用户带来的与快照.md) — 供给侧的源分类与质量判断
- [73 三餐：周计划、采购单与偏离](./info/73-三餐：周计划、采购单与偏离.md) — 按身体目标算热量蛋白的一周快手三餐：开场问答、程序解克数、采购单与偏离
- [77 办公室与红盒子](./info/77-办公室与红盒子.md) — info 的家：格子柜里一条线一个红盒，桌上是今天要看的，批注发回去干活

## companion

- [15 语音输入](./companion/15-语音输入.md) — 按住说话：桌面 STT 与 iOS 本机听写
- [27 实时语音](./companion/27-实时语音.md) — 边说边聊的实时语音路线
- [45 陪伴的形态](./companion/45-陪伴的形态.md) — 第一版陪伴：被唤起的语音可视化
- [66 Lumen](./companion/66-Lumen.md) — Lumen 的形象与常驻位置
- [68 Lumen与盒子的交互](./companion/68-Lumen与盒子的交互.md) — Lumen、公文盒与派工的交互

## ui

- [22 手机形态](./ui/22-手机形态.md) — 手机端的定位与形态
- [30 shadcn迁移](./ui/30-shadcn迁移.md) — 组件迁到 shadcn/ui 与浮层规矩
- [51 侧栏外壳](./ui/51-侧栏外壳.md) — 平板和桌面的常驻左侧栏
- [52 配色](./ui/52-配色.md) — 纸加苔绿的配色与 token
- [53 封面与书架页头](./ui/53-封面与书架页头.md) — 书架与主题页页头、封面样式
- [54 阅读器侧栏并排](./ui/54-阅读器侧栏并排.md) — 宽屏阅读器侧栏并排、窄屏抽屉

## platform

- [11 iOS-TestFlight发布](./platform/11-iOS-TestFlight发布.md) — iOS 上架 TestFlight 的清单与 CI
- [13 账户同步](./platform/13-账户同步.md) — 跨设备全量同步的引擎
- [18 iOS-Google登录](./platform/18-iOS-Google登录.md) — iOS 上 Google Drive 登录的做法
- [19 iOS侧载安装](./platform/19-iOS侧载安装.md) — 无开发者账号的 iPad 侧载
- [23 Android落地调研](./platform/23-Android落地调研.md) — Android 端的落地状态与做法
- [37 结构与架构优化](./platform/37-结构与架构优化.md) — 架构审计 22 项的记录与计划
- [50 删除](./platform/50-删除.md) — 删除一本书与同步的删除模型
- [59 同步：持有清单与裁决](./platform/59-同步：持有清单与裁决.md) — 按持有清单裁决的同步模型
- [76 桌面自动更新](./platform/76-桌面自动更新.md) — 桌面版从 GitHub Releases 自更新
- [78 分享](./platform/78-分享.md) — iOS 双向分享：Share Extension 进 Lumen 对话和书库，openin 往外交文字和链接

## pitfall

实测踩到的坑，一坑一文件，索引见 [pitfall/README.md](./pitfall/README.md)。

## research

调研级文档，不占编号，索引见 [research/README.md](./research/README.md)。

## north-star

认定要做、不在当前规划内的方向，索引见 [north-star/README.md](./north-star/README.md)。

## assets

调研原文、探针数据与图片，由各文档直接链接。

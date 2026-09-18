# 系统一判断模型

## 愿景

info 侧将来的大量决策是 yes/no：这条值不值得看、这道菜今晚合不合适、这条和昨天那条是不是一回事、这篇论文过没过线。这些是系统一决策：快、多、每个都便宜，要的不是一段话，是一个带置信度的答案。今天的 AI 产品几乎全是系统二（生成、推理、对话），系统一那一层是空白，而日常生活尤其是信息侧的决策大部分落在这一层。

认定的方向：把判断从生成里切出来，用专门的判断模型答 yes/no、选项、量表，输出校准过的概率；组合、阈值、反馈都留在代码里。这种模型一次前向读完 state，所有问题并行出答案，没有逐 token 解码，算力是 LLM 调用的零头，所以能进端侧。推荐系统跑在用户自己的设备上；机器人的控制环（路通不通、抓没抓住、该不该停）是同一个形状。

对单用户的推荐这是唯一成立的路：没有人群就没有协同过滤，只剩内容加判断。特征是用户看得懂的自然语言问题，反馈是改一句话或调一个阈值，和「对话是纠错界面」一致。

分工：soul（系统二）低频出题，判断模型（系统一）高频答题，代码组合。程序算得出的事实不经模型：主料和前三天重复是程序判断，腻不腻、像不像周二那道才是模型问题。

## 为什么现在不做

- 现有产品一处也不接。粗筛、排序、饭还在用 LLM 或还没做，量没到要单独一层的程度。
- 目前只有一家：TypeSafe AI 的 Jev，2026-09-16 起 early access，只有 API，没有开源权重，没有端侧版。等后续产品和开源模型出现再看。
- 到接的时候先定接口：`judge(state, questions) -> probabilities` 做成一个 capability，粗筛、回头重打、concern 排序权重、去重、饭的候选筛全走这一个口，后面接谁都行。

## 将来做时已知的事实

- Jev 的形态：state 是文本、JSON 或数组，上限 32k；一次请求一个 state 配多个问题，并行独立作答，加问题不加延迟；三种原语 Choice（选项加概率分布）、Score（量表加分布）、Noul（陈述为真的概率），可混用；每个答案带置信度，宣称校准（置信度高即准确率高）；输入 $0.042/MTok，输出免费；70-500ms；1200 请求/分钟；只吃文本；请求不用于训练。出处：[models](https://docs.typesafe.ai/models.md)、[state](https://docs.typesafe.ai/concepts/state.md)、[发布博客](https://typesafe.ai/blog/introducing-system-one-models-and-jev)。
- 已知短板（[jev-1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)）：按字面读问题，否定和隐含条件不揣摩；算术、计数、日期比较不可靠；长 state 里的无关内容是干扰项；相关问题之间的概率不保证自洽；state 里的注入指令能骗它；CJK 支持但精度不稳定；写不出字符串。
- 官方重排菜谱（[rerank](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)）是每个候选单发一次 Noul 再按概率排序，1200 次调用 $0.06；只能重排不能召回。
- 计算形状有先例：NLI 零样本分类（前提加假设出蕴含概率）在手机上跑了多年。Jev 新在指令跟随的广度、校准和产品形态。端侧小尺寸下的判断质量是唯一没有答案的问题。
- 我们侧对得上的位置：粗筛（[63](../63-情报局：研究室、专项组与态势.md) 的命中下标加置信度，「模型只交下标不交字符串」就是这个形）、论文第 0/3/14 天回头重打（[69](../69-源模型：索引、叙事源、用户带来的与快照.md)）、concern 影响排序权重（63，因贵一直没落地）、分析员前的成对去重、饭的候选筛。
- 会丢的东西：粗筛顺手产出的一句话摘要和 outside 理由（[65](../65-加工手册：常态模型、日更列表、滚雪球与稿.md)）判断模型写不出来；要推理的判断（只看 URL slug 猜、显著但出界）会退化。
- 机器人上文本模型不够，state 是图像和力矩，那是 VLM 加分类头的活，思路同、模型不同。
- 背景：TypeSafe AI 由前 OpenAI 研究员 Diogo Almeida 创办，2026-09-15 出 stealth，$40M 种子（DCVC 领投）。见 [BusinessWire](https://www.businesswire.com/news/home/20260915525333/en/TypeSafe-AI-Emerges-From-Stealth-With-$40M-in-Funding-With-New-Model-for-Composable-AI)、[Latent Space 的社区讨论](https://www.latent.space/p/ainews-jev-a-system-one-model-that)。

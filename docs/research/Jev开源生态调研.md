# Jev 开源生态调研

> Jev 2026-09-15 发布，本文是发布后五天的事实底账：TypeSafe 自己说了什么，社区做出了什么，哪些数字能引用。调研日期 2026-09-20，只查了资料，没有在本机跑过任何一个模型。下游是 [north-star/system-one](../north-star/system-one.md)。

## 结论

TypeSafe 仍然只有 API：唯一模型 `jev-1.13.0`，没有权重，没有论文，文档里没有自托管页，五天里对开放权重、蒸馏、小模型、端侧一个字都没说过，正面否定和模糊承诺都没有。

社区五天里出了两百多个相关项目，其中约二十个是真有可下载权重的复刻。方法学最严的是 [kev](https://github.com/jaredpalmer/kev)（冻结评测套件、锁定测试集、和真 Jev 逐题对比）和 [Bespoke-Nimble-9B](https://github.com/bespokelabsai/nimble)（数据、配方、权重三样全开）；要小而快是 [Laya](https://github.com/NandhaKishorM/laya)（421M）和 [Verdict](https://huggingface.co/heman10x/rlcd-modernbert-151m)（151M，ONNX + WebGPU）。没有任何一个同时追平 Jev 的校准质量和高基数选项能力。

架构不是秘密，社区当天就复现了形状：state 编码一次共享，每个问题一条互不串扰的并行分支，直接读候选 token 的 logits 出概率，不做自回归解码。有人在 HN 上说「这就是个 zero-shot 分类器」，CEO 回「exactly right!」。没公开的只有 RLCD 校准训练和自制数据，而校准恰恰是独立审计打得最狠的一处：两份独立评测都测出 Jev 的概率并不校准。

arXiv 上没有任何论文描述 Jev、System One 模型这个类别，或任何一个复刻。整个生态由博客、README 和 X 帖子构成。

## TypeSafe 的后续与官方口径

[models.md](https://docs.typesafe.ai/models.md)：唯一模型 `jev-1.13.0`，`jev-latest` 和 `jev-preview` 都解析到它。$0.042/百万输入 token，输出免费；250,000 token/秒、1,200 请求/分钟，文档注明因需求过大动态调整；64k 总上下文，state 加最长的那个问题占 32k；纯文本。没有 pricing、rate limits、self-hosting、deployment 的独立页面。

[model-jaggedness/jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md) 是官方自曝弱点页，内容已记在 north-star。

博客 09-15 之后没有新文章。CEO 在 HN 上说会发架构论文，到 09-20 没有；reward function、架构、训练流程、校准方法全部未披露，也没有公开的校准曲线。

GitHub org `typesafe-ai` 里没有模型代码、没有权重、没有训练脚本：

| 仓库 | 说明 | 最后更新 |
|---|---|---|
| `system-one-adapter-python` | 把 TypeSafeClient 接口转发到 OpenAI/Anthropic/Google 或任意 OpenAI 兼容端点（含本地） | 09-18（v0.1.5） |
| `typesafe-sdk-python` / `typesafe-sdk-js` | 官方 SDK | 09-18 / 09-15 |
| `skills` | 给 Claude Code 用的 Agent Skills，666 stars | 09-12 |
| `LLaDA` fork | 掩码扩散语言模型官方实现的 fork | 2025-06 |
| `vllm` fork | vLLM 的 fork | 2025-05 |

两个 fork 被社区当成架构线索，但都停在 2025 年年中，没有证据说明它们在服务 `jev-latest`。adapter 是官方唯一往「不依赖 TypeSafe」方向走的东西，但那是拿 LLM 冒充 Jev，不是放权重。

渠道一周内全部接上：Vercel AI Gateway（09-16，`typesafe-ai/jev`，走 AI SDK 7 的实验性 `evaluate`）、Cloudflare Workers AI（`typesafe/jev`，标注第三方）、OpenRouter（09-18 beta）。LangChain 和 Vercel 的 eve 把 Jev 接进 agent 控制回路。

Almeida 09-17 称 36 小时内放了 14 万人出等待名单；TechCrunch 09-18 报道需求大到 API 一度无法服务，有开源项目记录 09-19 出现 HTTP 402 额度耗尽，社区开始做三路 fallback。他发布后的可核实表态只有两条：训练数据全部自制（「这是我做过最好的赌注之一」），以及主打 intelligence 而不是 fear or hype。

## 架构共识与在先技术争议

[archerhume《Jev's Architecture Unmasked》](https://archerhume.com/posts/jevs-architecture-unmasked/) 用约 1 万次 API 调用探测，证据强的四条：概率是直接读出来的不是生成文本；state 编码一次共享，多问题并行建表示、分支之间无串扰（信息流实验验证）；选项之间有 listwise 交互，加一个无关的第五选项能把原有两项的 log-odds 差从 +0.38 压到 +0.11；1,200 道 MMLU 上 ECE 0.031。延迟实测（服务端计时，每档 8 次）：一个问题、state 从 360 到 29,835 token，中位 57.5ms → 218ms；短 state、问题从 1 到 1,500 个，中位 86.5ms → 610ms，100 题以内几乎不变。作者自标为推测的：可能是稀疏 MoE 的 causal decoder（依据是「3 万 token 约 160ms」，但文中自己的数据是 211-237ms，160ms 没有出处），并明说实验区分不了 causal decoder 和 bidirectional encoder。415 次探测比对 192 个公开 tokenizer 一个都对不上。

[kuhung/understanding-jev](https://github.com/kuhung/understanding-jev) 定位 Jev 为有状态的离散 token 分类器，靠 KV Cache 前缀共享让几十个问题复用一次 prefill：

Qwen-2.5-0.5B 读 logits 复现：<30ms，与官方一致率 73.8%。它 README 里的延迟数据和上面 archerhume 图 2 的中位数逐一相同，是转引。

两条实现路径：末位 logits 掩码投影（过滤候选 token ID 后 softmax），或 NLI cross-encoder（context 当前提、候选当假设）。失败模式：无思维链、选项顺序敏感、无关选项拉低正确答案置信、未标定时错误预测也给 ≥0.90。

[HN 主线程](https://news.ycombinator.com/item?id=49717558)（1800 分，约 480 评论）里 CEO 确认：RLCD 是训练方法，概率对着 outcome 优化，当前只吃 JSON/文本，模型「不小」，是零样本而非指令微调。开放权重不置可否，端侧没被回答。主要批评：「不会幻觉」语义上不诚实，类型安全不等于事实正确；速度对比不是同类对比；用户得提前把答案分布建模准，模糊语义照样出错；Doom demo 拿的是结构化游戏状态 JSON 不是像素。扩散说被 lilting.ch 反驳：扩散语言模型要 10-50 次完整前向，和 Jev 的单次前向对不上。

在先技术争议：Convai Innovations 的 Nandakishor M（Laya 作者）09-18 在 DEV 发文[《I Built Non-Autoregressive Decision Models a Year Ago》](https://dev.to/nandakishor_m_6cc0adfde9f/i-built-non-autoregressive-decision-models-a-year-ago-then-a-frontier-lab-called-it-a-18me)，主张 2025-03 的 [arXiv:2503.23303](https://arxiv.org/abs/2503.23303) 和 2025-09 的 [arXiv:2510.01237](https://arxiv.org/abs/2510.01237) 已经做了同样的非自回归决策，且当时就放了权重、数据集和 PyPI 包，指控 TypeSafe 把它当全新突破发布而没有论文、没有权重、没有数据。Laya 的文档也用 RLCD 这个名字描述自己的训练方法。TypeSafe 公开未回应。

服务侧的在先技术：Hydragen（共享前缀 attention）和 DeFT（树形结构推理 attention），证明共享 prefill 加多分支的服务模式早就可行。

## 有权重的复刻

按可信度从高到低。所有数字都是各项目自报，除非注明。

kev — [GitHub](https://github.com/jaredpalmer/kev) · [HF](https://huggingface.co/jaredpalmer/kev-4b)。09-17，Apache-2.0，542 stars。Qwen2.5-0.5B / Qwen3-0.6B/4B/8B 加 LoRA 和 pointer head。文档编码一次，所有问题打包进同一序列，block-causal mask 让每个问题看得见文档但看不见兄弟问题，隔离误差 4e-6。实现 `POST /v1/systemone`，官方 SDK 改 base_url 就能直连。锁定测试集上 kev-8b 域内 0.869（Jev 0.845）、域外 0.799（Jev 0.857），kev-4b 0.852 / 0.794。0.5B 在 Apple M5 上训练约 1h45m，4B/8B 在一块 H100 上 40-70 分钟，4B 在 32GB Mac 上 bf16 serve 约 1 秒一次。冻结评测套件加同题对比是这批里唯一一份，缺点是权重刚传、下载量个位数。

Bespoke-Nimble-9B — [GitHub](https://github.com/bespokelabsai/nimble) · [HF](https://huggingface.co/bespokelabs/Bespoke-Nimble-9B)。09-18，Apache-2.0，490 stars / 58 likes。Qwen3.5-9B 的 LoRA adapter，165 MiB。324 道 held-out：Nimble 90.1%，基座 66.4%，Jev 1.13.0 93.2%；明确声明没有从 Jev 蒸馏。数据策展是亮点：对比式造负例，翻一个事实让正确答案跟着翻，训练不需要概率标签；训练集 2826 条、10 个领域。限制写得直白：每字段最多 26 个选项，prompt 超 2048 token 直接拒绝而不是截断。

Laya — [GitHub](https://github.com/NandhaKishorM/laya) · [HF](https://huggingface.co/convaiinnovations/laya)。09-18，Apache-2.0，1358 stars / 559 likes（全场最高）。三个 checkpoint：ModernBERT-large 421M（英文）、mmBERT-base 322M（100+ 语言）、typed-decisions 421M；骨干之上是从零训的决策头（2 层 transformer、option-marker scorer、act/escalate 头）。自称用 RLCD 对严格恰当评分规则做 RL（log + spherical，序数题用 ranked probability score，REINFORCE 加 group-mean baseline）。支持 Choice/Score/Noul 三原语，完全离线，pip 装，带 Router 按文字系统自动选 checkpoint。T4 上单题 32.8-39.5ms、10 题批量 72.3ms。自报对 Jev：typed-decisions 0.766 对 0.727，AG News 0.950 对 0.910，DAIR Emotion 0.595 对 0.480，ECE 0.081 对 0.246。

四处要打折，卡片自己都写了而转载普遍略掉：Jev 那一列全是第三方发表的数字不是自测，样本和 prompt 都不同；Banking77 上 0.425 对 Jev 0.870，77 个标签时每个只分到 3-4 个 token；英文 checkpoint 在非拉丁文字上崩溃，高棉语 0.000 准确率却给 0.952 置信度；0.081 的 ECE 是域内拟合温度之后的，原始 ECE 0.213 差于 Jev 的 0.144（多语版从 0.314 标定到 0.106）。宣传口径全场最激进，底子（权重、代码、PyPI、Space、benchmark 文档）是实的。

NanoJev — [GitHub](https://github.com/TianyuCodings/NanoJev) · [HF](https://huggingface.co/C-Tianyu/NanoJev)。09-17，MIT，932 stars。Qwen3-0.6B 加结构化决策头，Choice 支持 2-255 个动态候选，另有 Boolean 和 Score。完整训练管线、数据集和六个变体 checkpoint 都在仓库里。迷宫导航 4×4 测试 19/20（Jev 20/20），6×6 OOD 18/20（Jev 19/20），原始 Qwen3-0.6B 只有 7/20 和 3/20。中文和韩文转载里推得最凶的一个。

decider-2b — [GitHub](https://github.com/Mapika/decider) · [HF](https://huggingface.co/Mapika/decider-2b)。09-16，Apache-2.0，1.88B，Qwen3.5-2B-Base 全量微调，另有 2.21B 的 vision 变体。约 95 个公开决策数据集加 agent 轨迹、网页元素选择、游戏状态，v8 之后再做 384 步以结果为奖励的校准 RL。支持 2-255 选项，state 最多 32k，`POST /v1/systemone` 兼容。v8 到 v10 的实测：浏览器点击任务 83% → 93%，held-out 73% → 92%。HF 718 次下载，是这批里下载量最高的。

open-jev-deberta-v3-large — [HF](https://huggingface.co/com-kotobalabs/open-jev-deberta-v3-large)。09-18，Apache-2.0，434M。只用公开 gold label 训练（banking77 / sst5 / boolq），没有合成答案和 teacher 模型；18000 个 state / 42000 个问题，一块 H100 跑 229 秒，约 0.25 美元。域内 0.854（ECE 0.022），OOD 0.690（ECE 0.035），H100 上 10 个问题 28ms。卡片自己写「它只部分读懂问题」，OOD 掉 16 个点，新的有序刻度几乎只比多数类基线好一点。当基线读最合适。

Verdict / rlcd-modernbert-151m — [HF](https://huggingface.co/heman10x/rlcd-modernbert-151m)。09-17，Apache-2.0，151M，底座 knowledgator/gliclass-modern-base-v2.0。25 个候选槽，其中一个是显式弃权槽 `__insufficient_evidence__`。CE + Brier 复合损失，再做 L-BFGS 温度标定（T=1.0716）。提供 model.onnx 和 fp16 版，浏览器里跑 WebGPU/WASM <35ms。尺寸和交付形态是这批里对端上最友好的。

openjev（AlexWortega）— [HF](https://huggingface.co/AlexWortega/openjev)。09-16，MIT，207 likes。Qwen3.5-4B 当 NLI cross-encoder 接 MLP head，取 entailment 的 argmax。附 Doom、Flappy、Minecraft 的零样本控制代码。

cua-s1-forms — [HF](https://huggingface.co/cua-ai/cua-s1-forms)。09-18，MIT，706048 参数、2.8MB。字节级 embedding 加 2 层 Transformer encoder，GUI 表单填写专用，是 trycua/cua 里 cua-driver 的决策层。自报 99.7% 对托管 Jev 的 83.6%，但差距主要来自「把已填字段识别为 no-op」这条它训过而 Jev 没训过的约定；卡片声明不是 Jev 复刻、没用 RLCD。值得看的是尺寸：70 万参数就能做一个窄域的单次评分器。

Von-1.0 — [GitHub](https://github.com/wfzyx/von)。09-19，Apache-2.0，395M。自报 93.0% macro，GLiNER2 78.5%，Jev 97.2%，即自认落后四个点。MPS 约 62ms，CPU 约 300ms。基准只有 8 个任务 78 个 case，数字别当真。

更小或更窄的一批：system-one-mini（69M DistilBERT，五个固定决策）、system-one-qwen3.5-4b-scorer（LoRA 加标量头，CC-BY-NC-4.0，温度标定把 ECE 从 0.135 压到 0.044）、jev-schema-scorer-deberta-v3-large（435M）、system-one-gold（DeBERTa-v3-xsmall 70.8M）、modernbert-ja-310m-jev（日语）、[DECRUX9812/openjev-lm](https://github.com/DECRUX9812/openjev-lm)（Qwen2.5-0.5B + LoRA，6 vCPU 纯 CPU 过夜训完，人工金标 92.9%）、[capitaharlock/jev-clone](https://github.com/capitaharlock/jev-clone)、[logan-markewich/jeff](https://github.com/logan-markewich/jeff)（GliFormer 驱动）。[vinnylarouge/jevlike](https://github.com/vinnylarouge/jevlike)（992 stars）是从零训字节 encoder 加 option head 的教学库，好几个分支的源头，[jevlike-esp32](https://github.com/david-cermak/jevlike-esp32) 把它塞进单片机固件，是目前唯一真正的端侧实例。

端上今天能跑的一档，按尺寸：Verdict 151M（ONNX + WebGPU，<35ms）、Laya 的 mmBERT-base 322M 和 ModernBERT-large 421M（T4 上 33-40ms，CPU 193-464ms）、kotoba 的 DeBERTa-v3-large 434M（M1 Max CPU 上 4 题 1.8 秒）、kev-4b（32GB Mac 约 1 秒）。三件事要先接受：所有这些模型在没见过的问题和选项集上都掉 15 个点以上（kotoba 那份量得最清楚，0.854 → 0.690）；置信度必须在自己的数据上重新拟合温度，域外普遍过度自信；超过 20 个选项时小 encoder 会崩。

## 不训练、只读 logits 的一类

复刻了输入输出形状和速度，没有新权重，也没有复刻训练和校准，所以没有一个声称达到了 Jev 的校准质量。核心手法一致：广播一次 prefill，在每个 schema 字段位置只评估合法候选的 logits，softmax 出概率。

- [TheoLeeCJ/SemIf](https://github.com/TheoLeeCJ/openjev)（原名 openjev）：1958 stars，全场最高。Qwen3.5-4B 冻结，21 个决策 1.02s 对生成 JSON 的 5.33s，modal agreement 0.845 对 Jev 0.883。带 WebGPU 浏览器 demo。
- [githubnext/localjev](https://github.com/githubnext/localjev)：434 stars，GitHub Next 官方出的。Bun server 把 oMLX DiffusionGemma 放在 `/v1/systemone` 后面。它是提示模型输出 JSON 概率，不是读 logits，线兼容但不等价，自己写明了。附 1200 次请求的 bake-off。
- [ekzhang/openjev-sglang](https://github.com/ekzhang/openjev-sglang)：195 stars，Qwen3.6-35B-A3B 加 SGLang radix cache 保住共享 prefill，64 个并行任务 1 秒内完成。
- [r-ms/mini-jev](https://github.com/r-ms/mini-jev)：Qwen3-4B 冻结读字母 logits，CLINC150 0.907 对生成 JSON 的 0.909，32-token 文本快约 4 倍。
- vLLM PR #57250（Matt Mastracci）：给 DiffusionGemma 加 Jev 式结构化模式，单 token 答案槽用 logprobs 和熵做置信，8.7-54 请求/秒，实测不比 Jev 慢、质量大致打平。未合并。
- MLX parallel constrained decoding：Qwen2.5-1.5B-Instruct-4bit 在 Apple Silicon 上 75ms 对自回归 420ms。
- 其余：[zhengxuyu/litjev](https://github.com/zhengxuyu/litjev)、[razorback16/openjev](https://github.com/razorback16/openjev)、jevmlx、snellingio/system-one、jevfire、PocketJev（iPhone 上 MLX 跑 Qwen3-VL，摄像头帧加三选一约 1 秒）。
- LFM2.5-350M-RLCD / LFM2.5-2.6B-RLCD：Liquid 权重不变的纯推理技巧，8-63 倍加速但字段准确率只有约 60%。

## 早于 Jev 的同形态模型

- [GLiNER 2.5](https://huggingface.co/fastino/gliner2.5-multi-v1)：2026-08-14 发布，比 Jev 早一个月。Apache-2.0，74M / 194M / 287M 三档，多语言那个 20 万次下载。schema 驱动，实体、分类、结构化记录、关系、span 属性在一次 boundary encoder pass 里全出，本地 CPU/CUDA/MPS 都能跑。Fastino 在 Jev 的发布线程下直接回了一句「权重在 Hugging Face 上」。差别是没有 Choice/Score/Noul 的类型语义，也没有针对校准做 RL。
- [GLiClass](https://arxiv.org/abs/2508.07662)（Knowledgator）：label 和文本一起进 encoder，每个 label 出一个概率，不解码。Verdict 151M 就是拿它的 modern-base-v2.0 当底座。HN 上被反复点名的就是这个。
- [零样本蕴含分类](https://arxiv.org/abs/1909.00161)（EMNLP 2019）：Jev 的 Choice 形状 2019 年就定下来了。
- [monoBERT](https://arxiv.org/abs/1901.04085)：一对文本进、一个标量相关性概率出，Score 的直系祖先。
- [Llama Guard](https://arxiv.org/abs/2312.06674)：固定分类体系，判决从一个 safe/unsafe token 的概率读出来，就是 Noul。
- [RLCR](https://arxiv.org/abs/2507.16806)（ICLR 2026）：在 RLVR 上加 Brier 评分奖励训校准置信度，是 RLCD 在公开文献里最近的亲戚。[Rewarding Doubt](https://arxiv.org/abs/2503.02623) 是同一想法的独立再发现。
- [LLaDA](https://arxiv.org/abs/2502.09992)：typesafe-ai 的 org fork 了它，是「怎么一次填满所有答案槽」的最强公开线索。
- [InstructGPT reward model](https://arxiv.org/abs/2203.02155)：Bradley-Terry head 一次前向出一个标量，不生成文本；论文作者里有 Jev 的创始人。

## 独立评测

比厂商数字有用。

[nibzard/decision-model-benchmark](https://github.com/nibzard/decision-model-benchmark) 最硬：冻结协议、5 个套件 60 个 cell、28.34 美元真实花费、原始日志全公开、无厂商赞助。结论对 Jev 不客气：banking 77 路分类 76.3% 只在中游（gpt-oss-120b 81.3%、glm-5.3 80.4%）；p50 264-276ms 只比 Cerebras 上的 gpt-oss 快 1.2 倍，「40-200 倍」只在对手开着思考模式时成立；256 个选项直接返回 `400 Too many choices`；强制不确定的题目上只有 49.7% 承认不知道，而所有 LLM 是 97.3-100%；ECE 0.246 是全场最差；打乱选项顺序会改掉 13% 的答案。便宜是真的：每千次决策 0.07 美元，最便宜的 LLM 要 0.19。

[SamuelSacco/jev-exploration](https://github.com/SamuelSacco/jev-exploration) 专打校准：ECE 跑出来是噪声底的 2.1-2.5 倍，四个难度档全中，包括 97.5% 准确率那档；官方常被引用的 n=60 基准根本测不出校准，完美模型在那个样本量下 ECE 约 0.045，正好落在官方报告的区间里；失真模式一致，向中间压缩，高置信被低估、低置信被高估。建议当单调分数用，每个领域拿几百条标注重新标定；p≥0.9 时在 21.5-32.5% 覆盖率下命中率 1.000。

重排序对比 — [anessbelbati/jev-rerank-bench](https://github.com/anessbelbati/jev-rerank-bench)，8 个英文数据集、1,617 条 query：

| 模型 | nDCG@10 | 延迟 | 每千次成本 |
|---|---|---|---|
| Jev（四级 rubric） | 0.692 | 422ms | $0.45 |
| Cohere Rerank 4 Pro | 0.691 | 844ms | $2.51 |
| ZeroEntropy zerank-2 | 0.682 | 1.8s | $0.22 |
| DeepSeek V4.1 Flash | 0.682 | 2.2s | $1.13 |

Jev 与 Cohere 的差是 +0.001（95% 区间 -0.009 到 +0.012），作者结论是既非胜出也非等价；Jev 在否定题上明显好（71% 对 67%）。开源对照里 Qwen2.5-1.5B RLCD 批量模式只有 0.255-0.340，单条提示 0.471，不如 BM25 的 0.486。

零样本分类对比 — [zhuyansen/jev-zeroshot-vs-bert](https://github.com/zhuyansen/jev-zeroshot-vs-bert)：

| 任务 | Jev | DeBERTa-v3-large NLI |
|---|---|---|
| AG News | 0.865 | 0.763 |
| SST-2 | 0.960 | 0.913 |
| Banking77 | 0.712 | 0.579 |
| TweetEval-emotion | 0.827 | 0.760 |
| PAWS | 0.855 | 0.766 |

零样本下开源 encoder 顶不上 Jev；但把 Jev 的输出当特征做 logistic regression，8-128 个标注样本就能追平，部分任务要 2048 个以上。标签措辞影响最大。

其余：[rorshopping/jev-on-a-laptop](https://github.com/rorshopping/jev-on-a-laptop)（笔记本上 Qwen 7B 达到 73.8% 一致率对 Jev 的 86.6%，并发现置信度不可靠地标出错误）、[AbdelStark/jev-benchmarks](https://github.com/AbdelStark/jev-benchmarks)（校准、选择性风险、延迟的框架）、RINNECODER/jev-behavior-study（对闭源 1.13.0 的黑盒探测）、iammrduncan/typesafe-ai-benchmark。中文首个公开基准 130 条人工标注（工单派发、情感、垃圾评论、紧急度），Jev 97.7% 准确率、约 890ms、每千次约 ¥0.105。反例一条：某评测在钓鱼邮件任务上直接问 Jev 只有 62.6%，两行正则能到 91.8%（awesome-jev-zh 提到，未附来源链接）。

## 工具、跟踪器和清单

- [multimodalart/jev-reproductions-tracker](https://huggingface.co/spaces/multimodalart/jev-reproductions-tracker)（HF Space）：最有用的一份，按 decoding / diffusion / trained / prior art / explainers 五类排，每条带 stars、likes、X 互动数，底部专列「还没开的东西：TypeSafe 的权重、RLCD 算法本身、任何匹配 Jev 校准声明的开源模型」。数据是 09-18 的快照，页面动态加载，本次没取到原始数据。
- [yibie/awesome-jev](https://github.com/yibie/awesome-jev)：应用面最全，两百多条按用途分组。
- [OmniJev/awesome-jev](https://github.com/OmniJev/awesome-jev)：论文导向，22 篇，有一节 "The Shape Before Jev"。
- 其余清单：[AbdelStark/awesome-typesafe](https://github.com/AbdelStark/awesome-typesafe)、[yzfly/awesome-jev-zh](https://github.com/yzfly/awesome-jev-zh)（中文每日自动收录）、[MrJev/awesome-jev](https://github.com/MrJev/awesome-jev)（72 个经核实真的调用或复现 Jev 的项目）、AnotiaWang/awesome-jev。
- 第三方客户端覆盖 Go、Elixir、Ruby、Scala ZIO、Swift 6、Laravel、Rust CLI、SQLite 扩展、若干 MCP server 和 LlamaIndex/Hono 集成，都是薄封装，不影响选型。

## 空壳与存疑

- Archer Hume 承诺的 open-weight Jev：tracker 单独标成 promised 排在最后。2026-09-24 核对博客现行版本，正文里没有放权重的承诺，只有 "TypeSafe refuses to share their research… So I will (try my best)"，指的是分享研究；承诺可能出自 X 帖或更早版本，未核实。
- harshatheg/Qwen-2.5-1B-RLCD：427 个 HF like 很显眼，但仓库里没有权重文件，只有 Space 的 app.py 和 engine 代码。like 数在这里会误导。
- 09-19 到 09-20 刚传、0 下载、0-2 stars 的一批：dwidlee/systemone-lite-0.5b、shreyanbr 的三个、lafalce/system-one-model、Meanblock/JEV-CPU、us/jev-local、intikhab49/open-jev-typed-decision-engine（0 star 但 README 声称 150M encoder 0.697 对 Jev 0.727、校准好 2.5 倍）、BILLKISHORE/opensysone、jaswanthsanjay88/rev、akash-kamat/system-one-gemma。都有卡片有权重，无人验证，数字不要引用。
- Laya 对 Jev 的全部比较都是引用第三方数字、非自测，样本和 prompt 不同。
- DeepMost 销售转化 RL 模型（arXiv 2510.01237）关系较远，是 PPO over embeddings，当「先声」看而不是同形状。

## 搜过但没有的

arXiv 四个查询全部零结果：`all:"System One model"`、`all:"calibrated decisions" AND all:"non-autoregressive"`、`abs:"typed decisions"`、`all:"RLCD" AND all:calibrated`。HF Papers / Daily Papers 无相关条目。

HF 上 `typesafe`、`typesafe-ai`、`typesafeai` 三个 org 名零模型，models/spaces/datasets 搜 "typesafe" 三类全空，搜 "noul" 只有两个无关旧仓库。typesafe-ai 的 GitHub org 没有模型代码、权重或训练脚本。

TypeSafe 关于开放权重、蒸馏、小模型、端侧、VPC 自托管的表态一条都没有；09-15 之后没有新博客、新模型版本、定价变动、论文或合作伙伴公告（除渠道上架）。OpenAI/Google/Anthropic 这五天里没有发布对标产品或公开评论。没有任何公司级的「要做 Jev 开源克隆」声明，所有克隆都是个人开发者仓库，Laya 背后的 Convai Innovations 是唯一有公司身份的，而它的立场是在先技术主张不是跟进。

机器之心、量子位、新智元没有 Jev 报道，掘金和微信公众号也没搜到实质文章；中文覆盖集中在小型 AI 博客聚合站、动区动趋和 ic.work。

工具限制导致的第一手缺口，以下内容在本文中全部是二手转述、未经原帖核对：reddit.com 的域被搜索工具封（r/MachineLearning、r/LocalLLaMA、r/LLMDevs 的原帖都没读到）；x.com 返回 402 需要付费（@CompleteSkeptic、@typesafeai 等账号的原推都读不到，Almeida 那条 RLCD 发布推据称有 6.3 万赞）；知乎问题「如何看待前 OpenAI 研究员发布的新模型 Jev」返回 403；Forbes 两篇（Lance Eliot 的 RLCD 批评稿、Josipa Majic 的渠道稿）403；Medium《What Jev Probably Is》403。

## 来源

- 官方：[models](https://docs.typesafe.ai/models.md)、[jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)、[发布博客](https://typesafe.ai/blog/introducing-system-one-models-and-jev)、[system-one-adapter-python](https://github.com/typesafe-ai/system-one-adapter-python)
- 报道：[TechCrunch](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/)、[The Register](https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711)、[MarkTechPost](https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/)、[Forkast](https://forkast.news/typesafe-ais-jev-is-not-an-llm-and-that-may-be-the-point/)
- 讨论：[HN 主线程](https://news.ycombinator.com/item?id=49717558)、[Tildes 上手反馈](https://tildes.net/~tech/1w37/typesafe_ai_system_one_models_and_jev)、[apidog 复现横评](https://apidog.com/blog/openjev-open-source-jev-alternatives/)

# 端到端 / 全双工语音模型现状（2026-10-14）

所有来源于 2026-10-14 查阅；括号里的日期是来源本身的日期。GitHub 星数和最后推送时间用 `gh api repos/...` 当天取。"三方"指 Artificial Analysis 语音榜（[artificialanalysis.ai/speech-to-speech](https://artificialanalysis.ai/speech-to-speech)，页面写"As of July 2026"）：TTFA 是它从公网测的首音频时间，Conv. Dynamics 是它跑的 Full-Duplex-Bench 分数。

Anthropic 仍没有面向开发者的实时语音 API（只查到 Claude app 的语音模式，[搜索结果](https://www.outlookbusiness.com/deeptech/artificial-intelligence/anthropic-launches-beta-speech-mode-for-claude-ai-chatbot-adds-voice-conversations)），2026-07 的前提没变。

## 对比表

| 项目 | 双工 | 首响延迟 | 中文 | 能否外接文本 LLM / 工具 | 部署 | 许可（权重） | GitHub |
|---|---|---|---|---|---|---|---|
| Kyutai Moshi | 真全双工 | 论文 160ms 理论 / L4 实测 200ms；三方 FDB 61.0，推理 4% | 无（英） | 否；MoshiRAG 加异步检索 | iPhone 有 MLX 实验版；GPU 自托管 | CC-BY 4.0（RL 版 CC BY-NC） | 11.2k，2026-09-09 |
| Kyutai Unmute | 级联（STT+任意 LLM+TTS） | TTS 450-750ms（L40S） | 无（STT 仅英/法） | 是，任意 OpenAI 兼容 LLM | ≥16GB CUDA | MIT | 1.5k，2026-09-09 |
| Sesame CSM-1B | 不是对话模型，只是语音生成 | — | 无 | — | GPU | Apache-2.0 | 14.7k，2025-05 停更 |
| GLM-4-Voice | 半双工 | — | 中英 | 否 | 9B GPU | GLM 模型协议 | 3.2k，2024-12 停更 |
| Qwen2.5-Omni | 半双工（开源版） | — | 中英 | Thinker-Talker，Thinker 是自带的 | 7B/3B GPU | Apache-2.0 | 4.1k，2025-06 |
| Qwen3-Omni 30B-A3B | 开源版半双工 | 三方 Qwen3 Omni Realtime TTFA 0.88s | 中英（19 种输入 / 10 种输出） | 自带 Thinker；托管版有 function call | BF16 约 80GB 卡 | Apache-2.0 | 4.1k，2026-04 |
| Qwen3.5 / 3.8-Omni Realtime（托管） | 全双工 + semantic_vad（过滤附和和背景噪声） | 三方 3.5 Flash 0.79s / Plus 2.64s；3.8 未测 | 强 | 3.8 支持 function call、远程 MCP、联网搜索 | 只有 API（北京 / 新加坡） | 闭源 | — |
| Step-Audio 2 mini | 半双工 | — | 中英 | 支持 web search 工具 | 8B GPU | Apache-2.0 | 1.5k，2026-03 |
| Step-Audio R1.1 Realtime | 半双工，边说边想（双脑） | 三方 TTFA 1.53s，推理 98% | 中英 | 内部双脑，不能外接 | 开源权重 + API | Apache-2.0 | 0.7k，2026-04 |
| StepAudio 3 Realtime（托管） | 全双工 | 三方 TTFA 8.83s（推理模式），FDB 98.9 | 中英 | 自带 Voice Agent 调工具 | 只有 API（2026-09-15 上线） | 闭源 | — |
| MiniCPM-o 4.5 | 真全双工（1Hz 判断说不说） | TTFT 0.6s（未写硬件） | 中英 | 否（本体）；Gander 在它上面接外部大脑 | llama.cpp-omni：半双工 M3+16GB，全双工 M4 Max 24GB；PyTorch ≥28GB | Apache-2.0 | 26.7k（MiniCPM-V 仓），2026-10-14 |
| Tencent Gander | 真全双工 + 异步大脑 | 未公布 | 基座中英，README 未单列 | 是：可插拔 Brain，自带 Codex provider | 发布配置 3 张 GPU | Apache-2.0 | 0.6k，2026-09-17 |
| Kimi-Audio | 半双工 | — | 中英 | 否 | 7B GPU | 代码 Apache/MIT | 4.7k，2025-06 停更 |
| Freeze-Omni | 伪全双工（冻结 LLM + 状态分类头） | 三方 FDB 58.7，推理 33% | 中英 | LLM 冻结（Qwen2-7B），换脑要重训适配器 | GPU | 未声明 | 0.4k，2025-05 停更 |
| VITA-Audio | 半双工 | 首音频块 53ms（论文） | 中英 | 否 | 7B GPU | 未声明 | 0.7k，2025-05 |
| LLaMA-Omni 2 | 半双工 | — | Bilingual 版中英 | 否 | 0.5-32B | 禁止商用 | 0.3k，2025-05 |
| SALMONN-omni | 全双工（论文） | — | — | 否 | — | 仓库里没找到权重 | SALMONN 仓 1.5k |
| FireRedChat | 级联全双工（pVAD + EoT） | — | 中英 | 是，任意自托管 LLM | LiveKit 自托管 | Apache-2.0 | 0.6k，2025-09 |
| SpeechGPT 2.0-preview | 端到端 | — | 只中文 | 否 | GPU | Apache-2.0 | 0.4k，2025-01 停更 |
| NVIDIA PersonaPlex 7B | 真全双工（Moshi 架构） | 三方 FDB 91.0，推理 19% | 无（英） | 否 | GPU | NVIDIA Open Model License（可商用） | 11.2k，2026-03 |
| NVIDIA NemotronLabs VoiceChat 11B | 真全双工 + 原生工具调用 | 轮次延迟 448ms，打断后让出约 480ms（厂商）；三方 FDB 52.9 | 无（英） | 原生 tool call（FDB v3 pass@1 33%） | 80GB GPU | OpenMDW-1.1，标为研究用途 | NeMo |
| Fun-Audio-Chat 8B（通义） | 半双工 | — | 中英 | 支持 speech function call | 约 24GB | Apache-2.0 | 1.0k，2026-09 |
| Covo-Audio-Chat-FD（腾讯） | 全双工 | — | 中英 | 否 | 7B GPU | 仅学术，禁止商用 | 0.2k，2026-03 |
| Krafton Raon-SpeechChat | 全双工 | 三方 FDB 86.2 | 无（英/韩） | 否 | 9B GPU | 开放 | — |

托管 API 的价格量级（三方，美元/小时音频，输入/输出）：Qwen3.5 Omni Realtime 0.16/0.82，Gemini 3.1 Flash Live 0.35/1.38，GPT-Realtime-2 1.15/4.61，Grok Voice Fast 3/3，Step-Audio R1.1 Realtime 0.06/1.69。阿里官方价（[model-pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)，美元/百万 token，输入/输出音频）：qwen3.8-omni-flash-realtime 新加坡 0.93/1.87、北京 0.848/1.696；qwen3.5-omni-flash-realtime 新加坡 4.5/17.7。豆包端到端实时语音按 token 计费，单价没查到；智谱 GLM-Realtime 文档仍写限时免费；MiniCPM-o 4.5 在 2026-05-17 开了 API。

## 各项要点

**Kyutai。** Moshi 本体两年没换代，2026 年的动作是围绕它的：MoshiRAG（ICML 2026，[repo](https://github.com/kyutai-labs/moshi-rag)），前端发触发 token、后端异步检索、结果在"开口到说出要点"的空档里注入；RL 后训练版 moshika-rl-seamless（[博客 2026-06-10](https://kyutai.org/blog/2026-06-10-interactivity/)），减少乱插话、改进附和，但许可是 CC BY-NC；Hibiki-Zero 做同传。语言只有英/法，对我们不可用。Unmute 是级联框架，可接任意 LLM，但 STT 不支持中文（[delayed-streams-modeling](https://github.com/kyutai-labs/delayed-streams-modeling)）。moshi-swift 能在 iPhone 跑，README 自称 proof of concept。

**Qwen。** 开源权重停在 Qwen3-Omni（30B-A3B，半双工推理）。托管版一路升到 qwen3.8-omni-flash-realtime（[realtime 文档，更新于 2026-10-11](https://www.alibabacloud.com/help/en/model-studio/realtime)）：WebSocket/WebRTC，semantic_vad 过滤附和和背景噪声，支持自定义 function call 和远程 MCP（与联网搜索二选一），会话最长 120 分钟，没有新开源权重。中文是它的强项。这是现成最便宜、中文最好的全双工托管服务。

**StepFun。** 开源有 Step-Audio 2 mini 和 Step-Audio R1.1（Realtime 版"边说边想"双脑，Apache-2.0，[repo](https://github.com/stepfun-ai/Step-Audio-R1)）。StepAudio 3 Realtime（2026-09-15，只开 API）在三方榜上全双工 98.9、推理 100%，但三方 TTFA 8.83s，推理模式下首响很慢。

**MiniCPM-o 4.5 与 Gander。** MiniCPM-o 4.5（9B，Qwen3-8B 底座，[model card](https://huggingface.co/openbmb/MiniCPM-o-4_5)）是开源里唯一同时满足"真全双工 + 中英 + Apache + 有端侧路径"的模型；全双工端侧要 M4 Max 24GB，iPhone/iPad 只能跑半双工或做不了。腾讯 Gander（2026-09-09，[repo](https://github.com/Omni-Interaction-Gander/Omni-Interaction-Agent)）在它上面做成"小脑 + 大脑"：小脑每秒先出 listen/speak/interrupt/tool 控制 token，再出内容；tool 触发后由运行时把可信转写（另跑 faster-whisper）交给异步 Brain，Brain 的里程碑、追问、权限请求、结果都回到同一段对话。Brain 是 provider 注册表，自带 Codex（`codex app-server --stdio`），换别的 agent 不用改小脑。FDB v3：轮次 100%、过早打断 8%、工具 pass@1 0.40。

**NVIDIA。** PersonaPlex（Moshi 架构，可商用）和 NemotronLabs VoiceChat（11B，原生工具调用，研究许可）都只有英文。另有一篇前后端论文（[2609.19334](https://arxiv.org/abs/2609.19334)，2026-09）：全双工前端发 delegation token，把流式转写交给后端文本 LLM（例子是 Qwen3-235B），结果 prefill 回前端再说出来；EVA-Bench 上超过 GPT-realtime-mini 和 Qwen3-Omni，没放代码。

**其余。** GLM-4-Voice、Kimi-Audio、VITA-Audio、SpeechGPT 2.0、Freeze-Omni、Sesame CSM 都停更超过一年，Freeze-Omni 和 Moshi 在三方榜上推理分很低（33% / 4%）。LLaMA-Omni 2、Covo-Audio 禁止商用。SALMONN-omni 没找到可下载的权重。

## 嘈杂环境与多人说话

端到端全双工在噪声下普遍更差，问题出在"把非语音或旁人语音当成插话"：
- Moshi 在静音集误触发 168 次、噪声集 64 次，平均罚时 7.8s（[2603.24144](https://arxiv.org/abs/2603.24144)，2026-03）。
- FD-Bench 测 Moshi、Freeze-Omni、VITA-1.5，噪声和频繁打断下都失守，打断成功率相对下降超过 40%（[2507.19040](https://arxiv.org/abs/2507.19040)）。
- ICASSP 2026 HumDial 挑战总结：多人说话和瞬态噪声仍会导致误激活或漏检（[2604.21406](https://arxiv.org/abs/2604.21406)）。
- 双通道模型会把串进麦克风的旁人语音当成用户输入，IRAF 用说话人可靠度门控缓解（[2606.06559](https://arxiv.org/abs/2606.06559)，2026-06）。
- 厂商自称有改进的：豆包 SeedRealtime（[华尔街见闻 2026-08-05](https://wallstreetcn.com/articles/3778742)，不依赖外部 VAD，机场场景能区分旁人对话，没开 API 文档）、Qwen 托管版 semantic_vad、JoyAI-Talker（背景语音误触发率 0.10，[2608.01119](https://arxiv.org/abs/2608.01119)）。都没有独立复现。

级联侧对应的现成件：FireRedChat 的 pVAD（个性化 VAD，只对注册过的说话人触发打断，中英，Apache）、SoulX-Duplug（流式语义 VAD，中文推荐 paraformer，Apache，[repo](https://github.com/Soul-AILab/SoulX-Duplug)）、Pipecat Smart Turn v3.2（8MB int8，CPU 10-100ms，23 种语言含中文，BSD-2，[repo](https://github.com/pipecat-ai/smart-turn)，可上端侧）。

## 混合架构（小模型管对话，大模型给答案）

| 实现 | 前端 | 后端 | 交接方式 | 开源 | 结果 |
|---|---|---|---|---|---|
| Gander（腾讯，2026-09） | MiniCPM-o 4.5 全双工 | 可插拔 agent（自带 Codex） | tool 控制 token → 运行时起异步任务，可追加约束、分叉提问、取消 | 是，Apache | FDB v3 轮次 100%，工具 pass@1 0.40 |
| KAME（Sakana，ICASSP 2026） | Moshi | GPT-4.1 / Claude Opus 4.1 / Gemini 2.5 Flash 可换 | 后端异步慢节奏产出 oracle token，注入前端 | 是，MIT（[repo](https://github.com/SakanaAI/kame)） | 延迟同 Moshi、质量大幅提升；只有英文 |
| MoshiRAG（Kyutai，ICML 2026） | Moshi | 检索后端 | 触发 token → 异步检索，在开口后的空档注入 | 是，Apache | 事实性接近最好的非双工模型 |
| NVIDIA 前后端（2609.19334） | 全双工语音模型 | 文本 LLM（Qwen3-235B） | delegation token + 流式转写 → prefill-and-repeat 回前端 | 否 | 工具召回 92-97%，EVA-Bench 胜 GPT-realtime-mini |
| DuplexOmni（2606.09186） | 全双工交互层 | 可插拔思考层（推理 + 工具） | 两层异步并行 | 未见 | 无数字 |
| Step-Audio R1.1 / StepAudio 3 | 同一模型内的"表达脑" | 同一模型内的"构思脑" | 内部 | R1.1 开源 | 不能外接 |
| Talker-Reasoner（DeepMind，2410.08328） | 快 Talker | 慢 Reasoner | 共享记忆 | 否 | 文本 agent 概念原型 |
| 级联全双工：DuplexCascade（2603.09180）、X-Talk、FireRedChat、Unmute | 流式 ASR + 轮次模型 | 任意文本 LLM | 微轮次 / 语义 VAD | X-Talk、FireRedChat、Unmute 开源 | DuplexCascade 自称开源 S2S 里 FDB 和 VoiceBench 最好 |

共性：前端只管听、接话、附和、判断轮次和"要不要交给后端"，后端结果回来时由前端说出。前端不懂中文的（Moshi 系、NVIDIA 系、KAME）对我们不可用；中英可用的开源前端目前只有 MiniCPM-o 4.5（以及在它上面的 Gander）。后端交回的文本可以做检查点，但前端说出来时是复述还是照读，各实现都没保证逐字。

## 判断

纯端到端换掉 Claude 不成立：中文好的全双工模型推理能力不如 Claude，推理强的（StepAudio 3）首响 8 秒以上。值得做的是混合：前端换成全双工模型管轮次和附和，Claude 留在后端。两个值得实测：

1. **qwen3.8-omni-flash-realtime 当前端，Claude 做成它的 function。** 托管服务，iOS 直接走 WebRTC/WebSocket，几天能接起来，成本每小时几美分。system prompt 让它闲聊和附和自己答，实质问题调 `ask_claude(transcript)`，拿到结果后照读（同时把 Claude 原文存为检查点）。测：中英混说的识别、semantic_vad 在咖啡馆噪声和旁人说话下的误打断次数、正常回合首响、调 Claude 期间填充语是否自然、Claude 结果被改写的程度。
2. **Gander，把 Brain provider 换成 Claude（Claude Agent SDK 或直连 API）。** 开源里唯一现成的"全双工小脑 + 可插拔大脑"，中英底座。租 3 张 GPU（或把 Thinker/Talker/ASR 压到 1-2 张 24GB 卡）自托管，iPad 走 WebRTC 连。测同一组指标，另加：小脑自己回答的比例和质量、交给 Claude 后再追问或改口时任务是否正确续接。

两路用同一套录音脚本（安静 / 背景人声 / 街噪 × 中文 / 英文 / 中英混，每格 20 回合），和现有级联比三个数：首响 p50/p90、误打断率、该停不停率。若两路噪声下都不比现有级联好，先在级联里补 pVAD 和 Smart Turn，再看。

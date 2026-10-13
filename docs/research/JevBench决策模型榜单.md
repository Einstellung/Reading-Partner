# JevBench 决策模型榜单

> 2026-10-13。起因：info 侧要让 AI 夜里在桌面端用浏览器慢慢读 X，每一步决策（下一步做什么、这条帖子值不值得看、是不是引子帖）交给 Jev 这类“系统一”决策模型：输入 state 加类型化问题（Choice/Score/Noul），输出概率，不生成文本。用户机器是 RTX 3060 12GB、32GB 内存、i5-14400F。本文回答：现在榜上谁最强，哪些能在这台机器上本地跑，候选的权重、许可证和接口各是什么。只查了资料，没有下载权重，没有在本机跑任何模型。

## 对 9 月旧调研的修正

[Jev开源生态调研](Jev开源生态调研.md)（2026-09-20）写的是发布后五天的状态，以下几处已过时：

- 旧文说“没有任何一个同时追平 Jev 的校准质量和高基数选项能力”，最强复刻是 kev、Bespoke-Nimble-9B、Laya、decider-2b。现在榜上有 6 个开放权重系统的 Capability 超过 Jev 1.13.0 的 77.1，Intelligence 超过 Jev 的 63.6 的有 7 个；Calibration 达到或超过 Jev 的 90.6 的有 Jeff-1.0-Large（91.1）、Surogate Rune 26B-A4B v3（90.9）、Blink v0.3（90.7）。
- 领先的系统不再是 0.5B 到 9B 的小骨干，而是 Gemma-4-31B、Gemma-4-12B、Gemma-4-26B-A4B、Qwen3.5-4B、Qwen3.8-27B 上的微调或冻结读出。旧文里的 Laya 和 kev 8B 落在“Outside”区（成本或延迟超过 Jev 的 2 倍，不计名次），Bespoke-Nimble-9B 排到第 28。
- decider 已从 2B 做到 4B 和 12B。Mapika 的 decider-12b v2 排第 11。
- TypeSafe 自己的 Jev 仍然只有 API，榜上只作参照，没有权重。

旧文关于架构共识、独立评测的方法学批评（校准不可信、选项顺序敏感、n=60 测不出校准）仍然成立，下面第四节会用到。

## 榜单：BenchmarkHeaven 的 JevBench

页面 https://benchmarkheaven.com/jev-models，v1.7.46，2026-10-12 更新。页头写“155 ranked open-weights systems”，Jev 1.13.0 作参照（Intelligence 63.6、Calibration 90.6、Capability 77.1、每千次 $0.032、延迟估计 0.24s）。每个系统 1500 个决策；Capability 是 Intelligence 与 Calibration 的平均；“Jev-class”指成本和延迟不超过 Jev 的 2 倍，超出的列在 Outside 区，不计名次。p50 是榜站在自己 GPU 上回环测的单次延迟，不是网络延迟，也不是 3060 上的数。

我从页面文本抽出 148 个开放权重条目，前 49 名连续无缺，之后有几个名次因页面格式不同没抽到，不影响前 30 名。下表是前 30 名。底座和参数以条目标注为准，“draw”表示该行来自较新的抽题批次（见第四节）。

| 名次 | 系统 | 底座 | 参数 | Intelligence | Calibration | Capability | $/千次 | p50(s) | 3060 能跑 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Quyet-1.0-Large | gemma-4-31B-it | 31B | 73.4 | 90.0 | 81.7 | 0.045 | 0.116 | 否 |
| 2 | Jeff-1.0-Large (draw) | 未披露 | 未披露 | 71.9 | 91.1 | 81.5 | 0.049 | 0.080 | 未知 |
| 3 | decisio v0.8.0 on gemma-4-31B-it | gemma-4-31B-it | 31B | 70.4 | 88.7 | 79.6 | 0.041 | 0.047 | 否 |
| 4 | metask-jev-rain-31B-trained (draw) | 未披露 | 31B | 70.7 | 87.1 | 78.9 | 0.049 | 0.209 | 否 |
| 5 | metask-jev-rain-12B-trained (draw) | 未披露 | 12B | 67.8 | 87.9 | 77.9 | 0.041 | 0.115 | 能 |
| 6 | deck-31B | gemma-4-31B-it | 31B | 73.0 | 82.2 | 77.6 | 0.048 | 0.127 | 否 |
| 7 | René-1 31B FP8 | gemma-4-31B-it | 31B | 61.7 | 90.2 | 76.0 | 0.063 | 0.110 | 否 |
| 8 | H2O-Lightning-4B v1.1 | Qwen3.5-4B | 4B | 60.0 | 90.0 | 75.0 | 0.021 | 0.029 | 能 |
| 9 | Bobcat Flash 1.2 | gemma-4-26B-A4B-it | 26B-A4B | 65.8 | 81.2 | 73.5 | 0.048 | 0.061 | 否 |
| 10 | Surogate Rune 26B-A4B v3 | gemma-4-26B-A4B-it | 26B-A4B | 56.1 | 90.9 | 73.5 | 0.048 | 0.116 | 否 |
| 11 | decider-12b v2 (Mapika) | gemma-4-12B-it | 12B | 63.0 | 82.0 | 72.5 | 0.026 | 0.054 | 能（需自行量化） |
| 12 | Xor 26B-A4B | gemma-4-26B-A4B-it | 26B-A4B | 58.7 | 86.1 | 72.4 | 0.044 | 0.059 | 否 |
| 13 | decider-12b v1 | gemma-4-12B-it | 12B | 60.6 | 83.8 | 72.2 | 0.026 | 0.054 | 能 |
| 14 | torchcast-decision-12b | gemma-4-12B-it | 12B | 60.5 | 82.9 | 71.7 | 0.028 | 0.037 | 能 |
| 15 | Jev-Omni | gemma-4-12B-it | 12B | 55.5 | 87.0 | 71.3 | 0.029 | 0.155 | 能 |
| 16 | Winnow-12B Q8 | gemma-4-12B-it | 12B | 59.5 | 83.0 | 71.2 | 0.028 | 0.117 | 能（Q8 放不下，需 4bit） |
| 17 | Cygnet | gemma-4-12B-it | 12B | 54.8 | 87.0 | 70.9 | 0.028 | 0.037 | 能 |
| 18 | decisio v0.8.0 on gemma-4-12B-it | gemma-4-12B-it | 12B | 52.3 | 89.2 | 70.7 | 0.023 | 0.102 | 能 |
| 19 | decider chat on Gemma-4-31B-it | gemma-4-31B-it | 31B | 58.5 | 82.6 | 70.6 | 0.044 | 0.126 | 否 |
| 20 | GEV-26B-Decide | gemma-4-26B-A4B-it | 26B-A4B | 49.8 | 90.3 | 70.1 | 0.043 | 0.052 | 否 |
| 21 | decisio v0.9.0 on gemma-4-12B-it | gemma-4-12B-it | 12B | 52.3 | 87.6 | 70.0 | 0.023 | 0.132 | 能 |
| 22 | Blink v0.3 26B-A4B (draw) | 未披露 | 26B-A4B | 49.2 | 90.7 | 69.9 | 0.048 | 0.051 | 否 |
| 23 | Wald 4B v2.1 (draw) | 未披露 | 4B | 52.0 | 86.6 | 69.3 | 0.062 | 0.027 | 能 |
| 24 | Torchcast Decision 4B v1.1 (draw) | 未披露 | 4B | 54.2 | 83.1 | 68.7 | 0.020 | 0.021 | 能 |
| 25 | Hopper 12B trained | gemma-4-12B-it | 12B | 51.7 | 84.6 | 68.1 | 0.029 | 0.164 | 能 |
| 26 | SPX-CD-Omni | gemma-4-12B-it | 12B | 48.8 | 87.5 | 68.1 | 0.025 | 0.073 | 能 |
| 27 | Aplomb 1 | Qwen3.5-4B | 5.3B | 45.8 | 89.2 | 67.5 | 0.025 | 0.094 | 能 |
| 28 | Bespoke Nimble 9B v3 | Qwen3.5-9B | 9B | 56.5 | 77.0 | 66.8 | 0.063 | 0.094 | 能 |
| 29 | Metask rain 4B (draw) | 未披露 | 4B | 51.1 | 80.9 | 66.0 | 0.040 | 0.058 | 能 |
| 30 | Plumb-4B | JevK5（Qwen3.5-4B） | 4B | 43.0 | 87.9 | 65.4 | 0.017 | 0.020 | 能 |
| 参照 | Jev 1.13.0（TypeSafe，闭源 API） | 未披露 | 未披露 | 63.6 | 90.6 | 77.1 | 0.032 | 0.24（含网络估计） | 不适用 |

“3060 能跑”的判据：权重 4bit 后不超过约 9GB，给 KV cache 留余量。Gemma-4-12B 4bit 约 7GB（估算，不是实测），可以；26B-A4B 的 MoE 4bit 约 15GB，不行；31B 不行。表里的 12B 行标“能”的意思是体积上放得下，是否有现成的 4bit 权重和能跑的服务端，见下一节。

排在 30 名之后、Outside 区里的系统，Intelligence 超过 59.5 的全是 26B 以上（Perplexity Decider v1.1 27B 75.7、torchcast-decision-27b 71.8 等），没有更强的 12B 以下系统。唯一例外是第 105 名 Open Jev JSON Canvas（Intelligence 61.2，Capability 只有 30.6，参数量没核对）。因页面格式不同没抽到的几个低名次条目，只用页头的数字粗扫过，没有逐条核对。

## 候选

在 3060 能跑的系统里，按 Intelligence 取前五个：metask-jev-rain-12B-trained（67.8）、decider-12b v2（63.0）、H2O-Lightning-4B v1.1（60.0）、torchcast-decision-12b（60.5）、Winnow-12B（59.5）。按 Capability 排则 Jev-Omni（71.3）以 0.1 的差压过 Winnow（71.2），但它的 Intelligence 低 4 分，且是合并模型，没有展开核实。decider-12b v1 是 v2 的前一版，不单列。

下面的内容 2026-10-13 从 HF 卡片、HF API 和 GitHub README 核实。“未核实”表示这些页面没写，不是没有。

metask-jev-rain-12B-trained。HF：`MeTask-Rain/metask-jev-rain-12B-trained`，2026-10-11 更新。许可证标签 apache-2.0，卡片写“Apache 2.0, following the base model”。权重是 `google/gemma-4-12B-it-qat-q4_0-unquantized` 的 int4（compressed-tensors，W4A16）加一个 LoRA adapter（目录 `adapter/`，卡片要求 `enable_lora=True`、`max_lora_rank=16`）。卡片只给了 vLLM 0.31.0 的用法，测量机器是一块 A100 80GB。没有 GGUF，也没有量化衍生仓库。读出方式、是否实现 `/v1/systemone`、上下文长度、文件大小：卡片都没写，未核实。榜上这一行是“draw”批次（v1.6.14），底座在榜站标“undisclosed”，实际卡片写明了底座。关联的 GitHub 是 `metask-ai/metask-jev`，本次没有读。在 3060 上的可行性：int4 权重体积合适，但要用 vLLM 加载 LoRA，12GB 显存下能否跑通没有任何资料，只能自己试。

H2O-Lightning-4B v1.1。HF：`h2oai/h2o-lightning-4b`，另有官方 GGUF 仓库 `h2oai/h2o-lightning-4b-gguf`（2026-10-10 创建，10-13 更新）。许可证 Apache-2.0（标签和卡片正文都是）。底座 Qwen/Qwen3.5-4B，卡片称 4B，BF16 权重 8.4GB，GGUF 元数据显示 4.21B 参数。读出：卡片写“one forward pass and one output token”，并要求“every label is one token at the answer slot”，没有说是字母 logits、pointer 还是自定义 head，读出方式未明说。服务：卡片写“runs on unmodified vLLM 0.30.0”加一个标准库 Python 垫片，实现 `POST /v1/systemone`；只在一块 H100 上测过，“smaller cards have not been measured”。上下文：vLLM 以 `--max-model-len 40960` 服务，超出返回 422。GGUF 仓库里有 BF16 和 Q8_0（微调版），以及一批文件名带 `stock-experimental` 的 Q4_K_M、Q5_K_M、IQ2_XXS、IQ1_M，“stock”是否指未微调的底座，卡片没说，未核实；另有 `mmproj-lightning-f16.gguf` 和 `package/` 里的 Python 辅助文件。走 GGUF 时 `/v1/systemone` 由谁提供未核实。卡片自报在 231 题公开集上 205/231（88.7%），延迟 p50 0.033s（H100），属厂商自报。3060 上：BF16 8.4GB 本身就放得下，Q8_0 约 4.5GB（估算），这是五个里门槛最低的。

decider-12b v2。HF：`Mapika/decider-12b`，GitHub：`Mapika/decider`。许可证 apache-2.0；卡片写权重“derived from google/gemma-4-12B-it, Apache-2.0 as published by Google”，读出代码 Apache-2.0。底座 google/gemma-4-12B-it，单个 BF16 safetensors，GitHub 写“24 GB in bf16”。读出：option-letter logits，在答案位置读选项字母，带 Gemma 的 final-logit softcapping；GitHub 描述为隐状态投影到每个选项的一个标签 token，在拟合的温度下 softmax。服务：Python 库 `Decider("Mapika/decider-12b")`（PyTorch，CUDA/MPS/CPU），HTTP 服务器 `decider.serve`，大模型用 `decider.serve_vllm`（vLLM 0.29.0）；卡片要求 `decider-ai>=1.7.0`；`POST /v1/systemone` 已实现。GGUF 只有 2B 和 4B，12B 没有；HF 上 12B 的量化衍生只有一个社区的骁龙 NPU 4bit 移植，不是 GPU 路线。README 提到可选 FP8 线性层，但 12B FP8 仍约 12GB，装不进 3060；bitsandbytes 4bit 加载未核实。结论：体积上可行，但开箱不能在 3060 上跑，需要自己做 4bit 量化并验证读出没有退化。同系列 decider-4b 有 GGUF，但榜上 Intelligence 只有 40.1（v2，第 31 名）。

torchcast-decision-12b。HF：`torchcast-ai/torchcast-decision-12b`。许可证 cc-by-nc-4.0，卡片写“Model weights are labelled CC BY-NC 4.0, for non-commercial use”，服务代码 MIT，仓库里另带 `LICENSE-gemma-Apache-2.0`。底座 Gemma-4-12B-it 的微调，BF16 safetensors 约 23.95GB。读出：“reads the option letters at the answer position”，卡片没用“logits”一词，也没提 pointer 或自定义 head；仓库有 `readout_config.json` 和 `torchcast_shim.py`。卡片要求“Use the supplied serving package for typed decisions”，并说通用的 Hub text-generation 示例“do not reproduce the evaluated interface”。记录的运行环境是 vLLM 0.30.0、一块 H100 80GB。`POST /v1/systemone` 已实现，问题名 `decision`。上下文 16,384 token 含渲染后的请求，超出 422。官方没有 GGUF；第三方有 `mradermacher/torchcast-decision-12b-GGUF`，它是否保留这个读出接口未核实。非商业许可对本项目的含义：我们不分发权重，用户在本机下载自用不冲突；但如果将来 Reading-Partner 走商业化，它不能作默认推荐。

Winnow-12B。HF：`EldanRing/Winnow-12B`，服务端：`EldanRing/winnow-inference`。许可证标签 apache-2.0，卡片说“released under Apache 2.0”，但那个链接指向 Gemma 4 的许可页，仓库带 LICENSE 与 NOTICE；服务端代码 MIT，GitHub 写“Model weights retain their own model terms”。底座 Gemma 4 12B IT 的微调，据第三方目录（llmreference）是 rank-32 LoRA 合并，卡片本身未写。文件：`Winnow-12B-Q8_0.gguf` 12.67GB、`Winnow-12B-BF16.gguf` 23.83GB、`Winnow-12B-NVFP4.gguf` 8.16GB、`mmproj-Winnow-12B.gguf` 175MB，另有 SHA256SUMS 和 docs。读出方式卡片没写，服务端说“scores those options through `/v1/systemone`”，“Candidate probabilities are normalized over the supplied options”，机制未核实。服务端是基于 llama.cpp 的原生服务器，“sharing one loaded model”，支持 Choice/Score/Noul 的 `/v1/systemone`，是五个候选里唯一原生走 llama.cpp 且带决策接口的。文档记录的配置是 16GB 的 RTX 5070 Ti 上 Q8 全部上 GPU、64K 上下文；Linux/CUDA 的 NVFP4 预设用 8K 上下文。12GB 显卡的要求没写。3060 上：Q8_0 12.67GB 放不下；NVFP4 文件 8.16GB，体积合适，但 NVFP4 在 Ampere 卡（3060）上能不能跑、速度如何未核实；另一条路是用 llama.cpp 把 BF16 GGUF 自己量化成 Q4_K_M（约 7GB，估算），榜上测的是 Q8，4bit 的精度损失没有数据。

小结，一行一个：

| 候选 | 大小 | Intelligence | 许可证 | llama.cpp |
|---|---|---|---|---|
| metask-jev-rain-12B-trained | 12B，int4 + LoRA | 67.8 | Apache-2.0 | 无 GGUF，卡片只讲 vLLM |
| decider-12b v2 | 12B，BF16 24GB | 63.0 | Apache-2.0 | 12B 无 GGUF（2B/4B 有） |
| torchcast-decision-12b | 12B，BF16 约 24GB | 60.5 | CC-BY-NC-4.0 | 官方无，第三方 GGUF 读出未核实 |
| H2O-Lightning-4B v1.1 | 4B，BF16 8.4GB | 60.0 | Apache-2.0 | 官方 GGUF（BF16/Q8_0），服务方式未核实 |
| Winnow-12B | 12B，NVFP4 8.16GB | 59.5 | Apache-2.0（标签） | 原生 llama.cpp 服务端，实现 `/v1/systemone` |

按门槛排：H2O-Lightning-4B 最低（BF16 就放得下，Apache，有接口，有官方 GGUF），Winnow 次之（要选合适的量化），metask-12B 分最高但只有 vLLM 路径且接口和读出都没写，decider-12b 与 torchcast-12b 需要自己量化，后者还有非商业限制。第一轮建议先用 H2O-Lightning-4B 搭好 `/v1/systemone` 调用和标注集评估流程，再换 metask-12B 和 Winnow 对比。

## 两个榜各测什么，局限

BenchmarkHeaven 的 JevBench 测决策准确率与校准：同一套 300 个公开题加各批次的封存题，题目是“state 加 rubric 进，类型化答案出”，报 Intelligence（准确率一类）、Calibration、延迟和成本。局限有三点。其一，题目都不是浏览器导航，也不是“X 帖子值不值得看”或“是不是引子帖”。其二，新批次（标 draw 的行，如 metask-12B、Torchcast 4B、Wald 4B）用的是较新的抽题，页面明说锚点系统的重测还没完成，偏移量按 0 显示（“anchor runs pending: shown as published”），不同批次的分数不能严格比；页面还指出新批次的封存题得分比公开题推算的低 6 到 13 分，要么新题更难，要么参赛者在公开题上调过。其三，每个系统 1500 个决策，Calibration 的测量噪声不小（旧调研记过 n 小时校准测不准），换到自己的数据上要重新拟合温度。

jevbench.github.io 的 jevbench-mini（v0.1.0，21 个模型）测一致性（coherence）：不需要金标，检查概率之间是否满足逻辑与测度关系（选项互补、批内独立、改写不变、复述、包含排除等），另报准确率（1938 题）。它的参照模型 uniform（对所有问题给均匀分布）一致性 0.894，高于榜上全部模型（最高 open-jev-9b 0.839），所以一致性必须和准确率一起看，单看一致性等于奖励什么都不知道的模型。榜上准确率集中在 0.85 到 0.89，彼此的置信区间大量重叠，分不出高下。五个候选没有一个在这个榜上，榜上最近的是 decider-4b（一致性 0.784、准确率 0.886）。

两个榜都不测浏览器导航，也不测 X 帖子的价值判断，所以最终选型要在自己的 X 标注集上验：用同一批帖子和同样的问题措辞（值不值得看、是不是引子帖、下一步做什么），拿用户自己的标注当金标，对每个候选量准确率，并在这批数据上重新拟合温度，再看校准。榜上的 Intelligence 差距在这里不一定保持。

顺带一条：还有 ImageJevBench（吃截图的决策模型榜，页面里的 v0.3.0，在 BenchmarkHeaven 的同一站点），将来想让决策模型直接看浏览器截图而不是 DOM 文本时参考。本次没有读它的内容。

## 来源

- [BenchmarkHeaven JevBench](https://benchmarkheaven.com/jev-models)、[jevbench-mini](https://jevbench.github.io/)
- [h2oai/h2o-lightning-4b](https://huggingface.co/h2oai/h2o-lightning-4b)、[h2oai/h2o-lightning-4b-gguf](https://huggingface.co/h2oai/h2o-lightning-4b-gguf)
- [Mapika/decider-12b](https://huggingface.co/Mapika/decider-12b)、[Mapika/decider](https://github.com/Mapika/decider)
- [torchcast-ai/torchcast-decision-12b](https://huggingface.co/torchcast-ai/torchcast-decision-12b)、[mradermacher/torchcast-decision-12b-GGUF](https://huggingface.co/mradermacher/torchcast-decision-12b-GGUF)
- [MeTask-Rain/metask-jev-rain-12B-trained](https://huggingface.co/MeTask-Rain/metask-jev-rain-12B-trained)
- [EldanRing/Winnow-12B](https://huggingface.co/EldanRing/Winnow-12B)、[EldanRing/winnow-inference](https://github.com/EldanRing/winnow-inference)

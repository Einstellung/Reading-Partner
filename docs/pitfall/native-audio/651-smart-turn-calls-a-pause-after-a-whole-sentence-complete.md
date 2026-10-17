# 651 Smart Turn 把一句话说完之后的停顿判成说完了

## 现象

iPad 静默语音测试 run `zh-chat-then-delegate-2026-10-17T02-32-33-020Z`，神经 VAD：`zh-paper`（「这篇论文的结论站得住吗？方法上有没有问题？你帮我仔细查一下。」）被切成 4 轮，`zh-first`、`zh-chat-book` 各切成 2 轮。13 次 Smart Turn 有 11 次给出 0.97–0.99 的「完成」，句中停顿和真说完的分数一样高。被切开的那轮请求以 "Request was aborted" 结束。能量 VAD 一次没切，因为它的兜底 1250 ms 比 clip 里的停顿（290–930 ms）长。

## 原因

不是我们的输入错了。CoreML 版（aufklarer/Smart-Turn-v3.2-CoreML）把零均值单位方差归一化和 log-mel 都做进了模型（`model.mil` 里有对 `audio` 的 `reduce_mean` 和 `sqrt`）。输入要求 16 kHz、前面补零、最新的音频在末尾，`NeuralFront` 也是这么喂的：从本轮 duck 前 200 ms 到环形缓冲的末尾，最长 8 s。

从 `input.wav` 截出同一段窗口，喂给上游 pipecat-ai/smart-turn 的参考实现（`inference.py`：前补零到 8 s，`WhisperFeatureExtractor(chunk_length=8)`，`do_normalize=True`，`smart-turn-v3.2-gpu.onnx` 和 `-cpu.onnx`），分数和设备上的基本一致：

| 轮 | 位置 | 设备 CoreML | 参考 gpu | 参考 cpu |
|---|---|---|---|---|
| 1 | zh-hello 结尾 | 0.987 | 0.989 | 0.989 |
| 2 | zh-first「讲的是什么？」后 | 0.988 | 0.989 | 0.988 |
| 3 | zh-first 结尾 | 0.986 | 0.986 | 0.988 |
| 4 | zh-paper「结论」后 290 ms 的停顿 | 0.983 | 0.420 | 0.855 |
| 5 | zh-paper「站得住吗？」后 | 0.983 | 0.974 | 0.966 |
| 6 | zh-paper「有没有问题？」后 | 0.990 | 0.990 | 0.989 |
| 7 | zh-paper 结尾 | 0.990 | 0.990 | 0.989 |
| 8 | zh-chat-book「聊聊。」后 | 0.984 | 0.980 | 0.985 |
| 9 | zh-chat-book 句中 | 0.012 | 0.058 | 0.046 |
| 9 | zh-chat-book 结尾 | 0.982 | 0.978 | 0.986 |
| 10 | zh-chat-why「这本？」后 | 0.568 | 0.913 | 0.987 |
| 11 | zh-chat-why 结尾 | 0.984 | 0.977 | 0.957 |
| 12 | zh-read-it 结尾 | 0.972 | 0.959 | 0.981 |

窗口末端只能从日志定到一个 tap 周期（100 ms）以内，第 4、10 轮落在短停顿上，末端差几十毫秒分数就会变，这两轮对不上是这个原因。其余 11 轮相差不到 0.02。

被切开的停顿前面几乎都是完整的问句。模型按它学到的判：这句话说完了。edge-tts 在「？」「。」后面停 0.8–0.9 s，真人在两句话之间想一下也是这样。阈值和 `pauseMs` 都分不开这两种情况：句间停顿和真结尾分数一样高；`pauseMs` 要超过 930 ms 才不切，判停 p50 就从 403 ms 退回到能量 VAD 的 1231 ms 附近。

## 解法

判停不动。`voice-session.ts` 把「回复还没出声，用户就接着说了」并回上一轮：`speech-stop` 本来就会把还没出声的回复先压着，等到 `speech-end` 带着字到了，就 abort 压着的那条回复，把两段拼起来，用上一轮的编号重新问。记录里替换上一轮那一行，不加新行；后来那一轮的 `final` 也记到上一轮上。回复已经出声的，照旧按打断处理。

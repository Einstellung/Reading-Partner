# 端侧 ASR 调研

> 上游是 [15](./15-语音输入.md)（桌面那条送硅基流动）和 [27](./27-实时语音.md)（「Linux 桌面和 Android 的 ASR 换件」一直没定）。iOS 已经在设备上听写（[33](./33-语音简报.md)），本文不动它。调研日期 2026-09-12，只查了资料，没在本机跑过。

## 结论

桌面的按住说话换成本机推理：Rust 侧接 sherpa-onnx 的官方 crate，模型用 SenseVoiceSmall int8（226 MB），和今天云端跑的是同一个模型。硅基流动那条留作设置里的备选，模型没下好之前顶着。

理由三条：它就是现在在用的模型，换过去不改识别质量，只去掉网络、key 和上传；CPU 上非自回归一趟出结果，五秒话在桌面 CPU 上百毫秒级，比云端往返快；sherpa-onnx 一套运行时同时盖住 Linux、macOS、Windows 和以后的 Android，流式模型和带热词的模型都在同一个 crate 里，以后换件不换运行时。

## 现状

桌面：Rust `cpal` 采集，混单声道、重采样到 16k、编 WAV，经 IPC 回 JS，`cleanTauriFetch` 送 `api.siliconflow.cn` 的 `FunAudioLLM/SenseVoiceSmall`，再过一次 LLM 润色。iOS：`SpeechAnalyzer`，全在设备上。Android：两条都没有。

## 候选

全部能在 sherpa-onnx 1.13.8（2026-09-10）里跑，模型都是 int8：

| 模型 | 体积 | CPU RTF | 流式 | 热词 | 中文 CER（AISHELL-1 / WenetSpeech 会议） |
|---|---|---|---|---|---|
| SenseVoiceSmall | 226 MB | 0.05（A76 四线程）；M 系列 160 倍实时 | 无 | 无 | 2.96 / 6.73 |
| 流式 Zipformer zh（2025-06-30） | 160 MB | 约 0.15 | 有 | 有 | 未查 |
| 流式 Paraformer 中英 | 226 MB | 0.15 | 有 | 无 | Paraformer-Large 1.68 / 约 7 |
| Qwen3-ASR 0.6B | 约 980 MB | 桌面 x86 约 0.3；解码每 token 约 100 ms | 伪流式 | 有 | Fleurs-zh 2.88（官方） |
| FunASR-Nano | 948 MB | 0.17（两线程） | 无 | 有 | 未查 |
| FireRedASR2 CTC | 740 MB | 0.17 | 无 | 无 | AED 版 0.57 / 4.53 |

CER 那列是文献数，不是同一测试台上量的，只看量级。RTF 是 sherpa-onnx 文档和第三方在 ARM 或 M 系列上的数，x86 笔记本没有人测过，接进去第一件事就是量。

出局的：whisper.cpp（中文 CER 20% 上下，比 SenseVoice 慢五到十倍）；Qwen3-ASR 1.7B（CPU 上不到实时）；FireRedASR2（740 MB 换来的精度提升对听写没用，还没热词）；Vosk（旧）。macOS 26 的 `SpeechAnalyzer` 能用，但桌面上要再搭一层 Swift 桥，为一个平台开第二条路不值。

## 为什么先不上带热词的

SenseVoice 没有热词，今天云端那条也没有，术语表本来就是靠润色 pass 兜的（docs/15），换过去不丢东西。要热词就是 Qwen3-ASR 0.6B 或 FunASR-Nano：都是 LLM 解码，模型近 1 GB，一句话要等一秒上下。等按住说话在本机跑稳了、真觉得专名错得多再换，代价只是换模型文件和一个 config 结构。

## 流式

桌面按住说话松手前不显示文字，是故意的（docs/15），离线模型够用。docs/27 那条桌面实时语音要流式时，同一 crate 里的流式 Zipformer zh（160 MB，带热词）是首选。

## 接法

运行时：`sherpa-onnx` crate（k2-fsa 官方，`sherpa-rs` 已废弃并指向它）。默认静态链接，build script 从 GitHub releases 下对应平台的预编译库，缓存在 `target/sherpa-onnx-prebuilt/`；`SHERPA_ONNX_LIB_DIR` 或 `SHERPA_ONNX_ARCHIVE_DIR` 可指本地副本，国内开发机大概率要用。依赖按目标平台圈住，和 `tauri-plugin-autostart` 一样只给三个桌面平台，iOS 和 Android 的构建不碰它。静态库自带 onnxruntime；桌面包体会多多少没查到准数（Android 的 `libonnxruntime.so` 5.8 MB，aarch64 Linux 的 15 MB，桌面按 10 到 30 MB 估），装上再量。

模型不进包体，第一次用时下到 AppData，和 iOS 上 `AssetInventory` 一个意思。下载源 GitHub releases 国内慢，备 ModelScope 或 hf-mirror；校验和写死。设置里的 STT 卡加一个「本机 / 云端」开关和下载进度，模型没就绪时自动走云端。

推理放 Rust：`voice.rs` 停录时手里已经是 16k 单声道 f32，直接喂 `OfflineRecognizer`，不再编 WAV、不再经 IPC 传字节数组（坑 29 那条重负担顺手没了）。识别器进语音模式时加载、离开后释放；内存按第三方测的 fp32 峰值 0.95 GiB 打折，int8 应在几百 MB。用 2024-07-17 那版模型，`use_itn=1` 出标点；2025-09-09 那版不出标点。润色 pass 照旧。

## 分期

1. spike：加依赖、拿一段录好的 WAV 在 Linux 开发机上跑通，量 RTF、加载时间、内存、包体增量。半天。
2. 接进 `voice.rs` 和设置卡，云端做后备。
3. 桌面实时语音要做时再换流式模型。

## 未查证

- x86 笔记本上的 RTF 和加载时间。
- 桌面静态链接后的包体增量。
- SenseVoiceSmall 的模型许可写的是 `model-license`，条款没细读；本项目非商用，先不管。
- SenseVoice 2024-07-17 和 2025-09-09 两版精度差别，只知道后者不出标点。
- sherpa-onnx 的 crate 在 CI 三个桌面 runner 上从 GitHub 拉预编译库是否稳定。

## 来源

- sherpa-onnx：[SenseVoice 模型页](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)、[Qwen3-ASR](https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html)、[FunASR-Nano](https://k2-fsa.github.io/sherpa/onnx/funasr-nano/pretrained.html)、[FireRedASR](https://k2-fsa.github.io/sherpa/onnx/FireRedAsr/pretrained.html)、[流式 Paraformer](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/paraformer-models.html)、[流式 Zipformer](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)、[热词](https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html)、[CHANGELOG](https://github.com/k2-fsa/sherpa-onnx/blob/master/CHANGELOG.md)、[Rust 示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/rust-api-examples/README.md)、[crate](https://docs.rs/crate/sherpa-onnx/latest)、[sherpa-rs 废弃说明](https://github.com/thewh1teagle/sherpa-rs)
- CER 表：[ASR in 2025-2026](https://ruoqijin.com/blog/asr-deep-dive-2025-2026)、[Qwen3-ASR 技术报告](https://arxiv.org/abs/2601.21337)、[FunASR 模型选型](https://www.funasr.com/en/blog/which-funasr-model.html)
- M 系列实测：[Qwen3-ASR vs Whisper](https://whispernotes.app/blog/qwen3-asr-vs-whisper)、[SenseVoice vs Whisper](https://whispernotes.app/blog/sensevoice-fastest-cjk-transcription)
- Qwen3-ASR 0.6B CPU 数：[Qwen3-ASR-0.6B-ONNX-CPU](https://huggingface.co/Daumee/Qwen3-ASR-0.6B-ONNX-CPU)
- macOS 26 SpeechAnalyzer：[Apple 论坛](https://developer.apple.com/forums/thread/819555)

# 语音真机留档

出声和轮次那几轮在 iPhone 16 上跑出来的原始数据。结论在 [33](../../33-语音简报.md) 的「实测」，这里是判读的依据。

- `speech-result-2026-08-28.json` — 探针写在设备容器里的结果，三条夹具腿逐句的 `startFrame` / `frames` / `completionFrame` / `latencyMs` / `enqueuedAtMs` / `completedAtMs`，加整条 level 包络流。
- `route-survey-2026-08-28.json` — 六组 category options 的运行时路由真值，REDMI Buds 6 Pro 连着时量的。蓝牙那个决定就是按它定的。
- `judge.py` — 判读脚本，只吃 08-28 那一轮。用法 `python3 judge.py <放着 08-28 那两个 json 的目录>`。
- `device-report-2026-08-28.md` — 那一夜的中文实测记录。
- `echo-control-2026-08-29.json` — 回声对照轮，E3 的答案。`echo-vpio-on` / `echo-human` / `echo-human-duplex` 三条腿各自的转写、bigram 命中和电平峰均值，duplex 那条另记手机同时播的那段的命中；同一轮的六组路由真值和一条一句话的夹具腿也在里面。
- `turn-replay-2026-09-05.json` — 轮次检测机的 Swift/TS 对拍。17 个用例各自的输入帧、两侧的事件序列和逐位比对结果。
- `turn-result-2026-09-05.json` — 轮次探针。`detectorEvents` / `detectorStreamEnded`、两次 `finalize` 的时刻和 `callMs`、逐条转写（volatile 和定稿都带 `audioTimeRange`）、708 条一个缓冲区一条的 `inputRms`，加分段用的 stage 标记。33 里「VAD 和轮次检测」那三段的数全出自它。
- `speech-result-2026-09-05.json` — 同一夜的 speech 轮。三条夹具腿照旧，另外第一次有 live 腿的记录：`relay` 里 12 句的 started / failed 时刻和错误串。文件停在 `stage: "echo-vpio-off"`，那条腿仍然 abort（坑 203）。
- `device-report-2026-09-05.md` — 那一夜的中文实测记录，三条腿的完整判读和电平分布表。

三卷录音（`raw-burst` / `trimmed-burst` / `trimmed-measured`，24 kHz 单声道）没进仓库，11 MB 而且重跑就有：`scripts/ios-dictation/speech-run.sh` 跑一轮 `speech` 会重新录。人耳判过的那三条（拼接、句间停顿、裁剪）就是听它们得出的。

`judge.py` 的 `latencyMs` 判据还没改到位，见 `33` 的「未实测」。

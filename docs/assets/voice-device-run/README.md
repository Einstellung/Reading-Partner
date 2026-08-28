# 真机播放轮留档（2026-08-28）

M-voice-2 出声那一轮在 iPhone 16 上跑出来的原始数据。结论在 [33](../../33-语音简报.md) 的「实测」，这里是判读的依据。

- `speech-result-2026-08-28.json` — 探针写在设备容器里的结果，三条夹具腿逐句的 `startFrame` / `frames` / `completionFrame` / `latencyMs` / `enqueuedAtMs` / `completedAtMs`，加整条 level 包络流。
- `route-survey-2026-08-28.json` — 六组 category options 的运行时路由真值，REDMI Buds 6 Pro 连着时量的。蓝牙那个决定就是按它定的。
- `judge.py` — 判读脚本。用法 `python3 judge.py <放着上面两个 json 的目录>`。
- `device-report-2026-08-28.md` — 那一夜的中文实测记录。

三卷录音（`raw-burst` / `trimmed-burst` / `trimmed-measured`，24 kHz 单声道）没进仓库，11 MB 而且重跑就有：`scripts/ios-dictation/speech-run.sh` 跑一轮 `speech` 会重新录。人耳判过的那三条（拼接、句间停顿、裁剪）就是听它们得出的。

`judge.py` 的 `latencyMs` 判据还没改到位，见 `33` 的「未实测」。

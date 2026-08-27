# 陪伴形态调研留档

两轮调研的原始输出，机械转写自 JSON，措辞未改。结论已吸收进 [45](../../45-陪伴的形态.md)（形态、法律边界、将来升到形象时的事实）和 [33](../../33-语音简报.md)（「实测」里的 Qwen3-TTS 文献复核）。实测发现结论不对时回来查这里。

每份的 Fact-check 一节是核实阶段的结果：verdict 为 corrected 或 refuted 的条目推翻或修正了同一份里 Findings/Numbers 的原始值，以 Fact-check 为准。

## 第一轮，2026-08-26

六个维度加一份交叉核对。题目是「虚拟陪伴的技术与产品现状」，当时的假设还是做一个画出来的角色。

- `round1-01-shipped-products.md` — 2025–2026 已发货的虚拟陪伴产品和它们的技术栈，含 Grok Ani 退役、Character.AI、Replika、实体陪伴机器人的数字。
- `round1-02-character-runtimes.md` — Rive / Live2D / Lottie / Spine / Unity 的体积、许可和价格，以及单图转可绑定资产的流水线。
- `round1-03-lipsync.md` — 口型同步两条路：自绘角色的 viseme，和生成式说话人视频。
- `round1-04-realtime-voice-loop.md` — 实时语音回路的选型与成本。这一份和本仓库已落地的东西冲突最多，读之前先读 round1-07 的第 1 节。
- `round1-05-feeling-alive.md` — 让陪伴显得活着的行为设计，含眨眼与呼吸的常数、打断的代价、陪伴 app 的留存数字。
- `round1-06-platform-floor.md` — iOS/iPadOS 26 与 Tauri v2 的平台约束。
- `round1-07-critique.md` — 六个维度跑完后的交叉核对。它查了本仓库的代码和文档，纠正了前面各维度的多处错误（Live2D 的 iOS 支持、Rive 该用哪个包、口型方案与全原生音频架构不兼容、中国法完全没被覆盖）。

## 第二轮，2026-08-27

三个维度加一份结论稿。题目由第一轮的结论收窄。

- `round2-01-qwen-tts.md` — Qwen3-TTS 与硅基流动 CosyVoice2 的复核：价格、延迟证据、输出形态、工程量、音色。
- `round2-02-orb-form.md` — orb 的状态数、信号频率、平滑常数，以及 Mico 和 OpenAI 蓝球的两份讣告。
- `round2-03-legal-boundary.md` — 砍掉角色改变了哪些法律敞口：SB 243、纽约 GBL §1700、苹果年龄分级与 5.1.2(i)、中国的《暂行办法》与《标识办法》、GUARD Act。
- `round2-04-synthesis.md` — 结论稿，45 的正文按它写。

## 两轮之间的三处冲突

动画伤害理解的那个数。round1-05 引 Wang et al.（Journal of Eye Movement Research，2024-12-06，N=33 学龄前儿童，静态 3.02 对低相关动画 2.18）；round2-02 认为「~28% 理解下降」这个说法查不到出处，它找到的是另一篇（Ronconi et al.，JCAL 2024-12-19，N=54 大学生，无显著效应）。两篇是不同研究，45 引的是前者并写明了人群。

LOVOT 的价格。round1-05 的 $429 是 Casio Moflin 的价，不是 LOVOT 的；LOVOT 那条只有 0.2–0.4 s 反应和 37 °C 两个数。

每分钟成本的估算。round2-01 和 round2-04 按 250 汉字/分钟折算单价（¥0.0400 对 ¥0.0375 每分钟，一年差七块）。2026-08-27 的实测语速是 199 汉字/分钟，慢两成，重算是 ¥0.0425 对 ¥0.0391，见 [33](../../33-语音简报.md) 的「实测」。留档保留原文。

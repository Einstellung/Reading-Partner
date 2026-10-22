# 669 OpenAlex 的 related_works 不是近期论文

## 现象

文档说 work 的 `related_works` 是「共有主题最多的近期论文」。2026-10-22 实测：「Attention Is All You Need」（W2626778328）的 20 条是 1997 到 2019 年的经典（LSTM、ResNet、AlexNet 等），`filter=related_to:W2626778328` 回 15 条同样的；W4406779522 的 10 条跨 1964 到 2024 年。

## 原因

`related_works` 按共有概念挑，不看年份，文档说的「近期」不成立。

## 解法

S2 推荐不通时拿 OpenAlex 的 `related_works` 兜底，过一年的窗基本剩不下东西，不能当 S2 推荐的替代品看。兜底照做，流的 outcome 照实记（多半是 `empty`）。近期的相关论文靠被引流（`cites:` 加 `from_publication_date`）。

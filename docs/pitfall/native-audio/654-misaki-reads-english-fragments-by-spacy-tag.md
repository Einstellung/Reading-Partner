# 654 misaki 读中文句子里的英文片段，读法由 spaCy 对单个片段的词性决定

## 现象

同样是「全大写缩写」，`我们的服务器放在 AWS 上。` 里 misaki 0.9.4 把 AWS 读成 `ˈɔz`（像感叹词 aws），GPU、API 却是逐字母拼读。`我把 Wi-Fi 密码贴在冰箱上了。` 读成 `wˈIfˌI`，按空白切开分别查 Wi、Fi 都查不到。

## 原因

ZHG2P 把每段英文单独交给英文管线，spaCy 把这一小段当成一整句来标词性。词性直接决定 misaki 词典的走向：NNP 的全大写词不查 silver、查不到就拼字母；不是 NNP 时先转小写再查。spaCy 给 AWS 的是 NNS（以 S 结尾），于是走小写 `aws`。`Wi-Fi` 被切成 `Wi` `-` `Fi`，中间的 `-` 标 HYPH 而不是 `:`，三个 token 才会在 misaki 的 retokenize 里合成一个词去查 `Wi-Fi`；标成 `:` 就成了破折号 `—`。

## 解法

Rust 移植（`kokoro_g2p/en.rs` 的 `tokenize` / `tag_word`）没有 spaCy，用规则近似：全大写且以 S 结尾标 NNS，两边都不带空白的连字符标 HYPH，HYPH 之后的词标 NN。剩下的差异都在多音词的词性上（record、close、progress、used 等），测试 `gold_tests::KNOWN_DIFFS` 逐条列着；改规则后要跑 `gold_tests`，并用 venv 里的 spaCy 先看真实标注再动。

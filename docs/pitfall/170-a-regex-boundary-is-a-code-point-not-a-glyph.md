# 正则字符类的边界要按码点读：两个码点长得一模一样

## 现象

`src/smoke/dictation.ts` 和 `src/smoke/dictation-long.ts` 各抄了一份 `joinSpeech`
（生产版在 `src/ai/voice/dictation.ts:108`）。三份的 CJK 字符类逐字看过去一模一样，但
两个 bench 中英混说时把生产会留的空格吃掉了。

## 原因

字符类第二段范围的起点，生产是 U+F900（兼容汉字 豈），两份拷贝写的是 U+8C48（统一
汉字 豈）。两个码点渲染成同一个字形，编辑器、diff、review 里没有任何区别。

U+8C48–U+FAFF 是 28344 个码点，U+F900–U+FAFF 是 512 个，多出来 27832 个：谚文音节、
彝文、私用区全被算成 CJK。正则没有 `u` 标志，代理区 U+D800–U+DFFF 也在这段里，于是每个
emoji 的前导代理也算 CJK。

测试没拦住，是因为 bench 只跑过纯中文和纯英文，这两种输入下正确的和错误的范围结论一致。

## 解法

字符类的边界按码点读，不按字形读：写成 `\uF900` 这样的转义，或者临时
`"…".codePointAt(0).toString(16)` 打一遍确认。看着对不算数。

两份拷贝已经删掉，改成 import 生产的 `joinSpeech`。

# 流式切句器设计要点（草稿，交付前删）

落点 `src/info/briefing/speech/split.ts`，测试 `tests/info/speech-split.test.ts`。

## 接口

```ts
type SpokenSentence = { text: string; chars: number };
createSpeechSplitter(): { push(chunk: string): SpokenSentence[]; end(): SpokenSentence[] };
splitSentences(normalized: string): SpokenSentence[];   // 整段、已规范化
splitForSpeech(text: string): SpokenSentence[];         // 整段、含规范化
```

`chars` 是送给 TTS 的那串字的码点数，下游按「这一句共 N 字、总时长 T」线性插值。

## 安全冻结点

流式下不能把缓冲区随便切开去 normalize：`normalizeForSpeech` 的改写跨字符（日期、URL、`et al.`、单位、中英空格），冻早了 `2026-08-` 会被当完整文本改掉。

定义：raw 缓冲区里位置 i 是安全冻结点，当且仅当
1. `raw[i-1]` 属于硬边界 `。！？；：` 或 `\n`；
2. `raw[i]` 存在，且是字母、数字、CJK 表意字（`[㐀-鿿]`，和 normalize 自己用的范围一致），或 normalize 无条件删掉的引号 `「」『』“”《》〈〉"`。

冻结 `raw.slice(0, i)`，跑 normalize，结果追加进已规范化缓冲；若该段以 `\n` 结尾且 normalize 结果非空，补回一个 `\n`（normalize 末尾 `trim()` 会吃掉它，而它是切句器的硬边界）。

依据（逐条对着 normalize.ts 的 18 步）：

- 条件 1 挡住所有需要相邻字符的规则。URL（第 2 步）的字符类排除 `。！？；：` 和空白；日期、连字符、单位、分数、货币、时钟（4/5/7/9/10/11 步）都要求边界两侧是数字或字母；字母数字拆分和中英空格（13/16 步）同理。`。` 不在 `[㐀-鿿]`（U+3002 < U+3400），所以第 7 步的 CJK 连字符规则也跨不过去。词表 `PHRASE_READINGS`/`SYMBOL_READINGS` 的键里没有任何边界字符（查过）。
- 条件 2 挡住三类跨边界：
  - 后半段以 `^`（`m` 标志）起头会被误当行首。第 1 步的 `#`、`>`、`- * +` 列表标记，第 9 步的 `(^|[\s（(，,：:])[−-](\d)` 和 `\+(\d)`，都在片段开头凭空生效。
  - 第 18 步的合并：`([，。！？；：、])\1+` 会把跨冻结点的重复标点收成一个；`[^\S\n]+([，。！？；：、])` 和 `\n{2,}` 同理。要求首字符不是标点也不是空白就没了。
  - 第 15 步的 `(?<=\S)[-–](?=\S)` 用 `\S` 回看，`。` 满足。要求首字符不是连字符即可。
  - Markdown 的 `**`、`*`、反引号可以跨 `。`，但它们无论配没配对，最终都被第 1 步或第 15 步删成同一个结果，不影响。围栏 ```` ``` ```` 和内联链接 `[x](y)` 会跨，但两者都以 `` ` `` 和 `[` 开头，被条件 2 挡在片段开头之外；片段内部的完整构造由 normalize 自己处理。
- 拼接不丢字：前一段以硬边界收尾，后一段以内容字起头，normalize 不会在这个接缝上加或删空格。

不满足条件就不冻结，只是多等一个边界，不会出错。

## 切句规则（docs/33）

在已规范化的文本上做，硬边界 `。！？；：` 加 `\n`；软边界 `，、`，累积码点数超过阈值才切。第一句阈值 1（首字延迟压到最小），之后 12（docs/33 给的 8–12 带的上沿）。

「不在英文缩写、数字、URL 中间切」不需要额外规则：normalize 跑完 URL 已经变成「x 链接」，数字已经是汉字，缩写已经拆成带空格的字母，而 ASCII `.` 不在边界集里（normalize 第 18 步特意留着它，`Inc.` 和 `U.S.` 不是句末）。

## 验收

属性测试：任意分块喂进流式接口，吐出的序列逐字等于 `splitSentences(normalizeForSpeech(whole))`。覆盖逐字符喂、固定种子（mulberry32，不用 `Math.random`）随机分块、在日期／URL／缩写中间断开。end() 要 flush 尾巴，包括没有任何边界的短文本。

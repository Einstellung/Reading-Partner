# pi-ai 1.6 的输出夹紧多留 15%，反解 pi 的估算不再成立

## 现象

升 pi-ai 1.6.1 后 `tests/budget/estimate.test.ts` 红：一本 22 万字的中文书，`piBudget().tokens` 从 63237 变成 68627；多出来的正是 15% 的安全边。`allowedOutput` 也比 `窗口 - 估算 - 4096` 小。

## 原因

`clampMaxTokensToContext`（`dist/api/simple-options.js`）改成了：

```
margin = max(4096, ceil(input * 0.15))
room   = window - input - margin
if room < 32768: room = min(32768, window - input - 4096)
maxTokens = min(requested, max(1, room))
```

为 OpenRouter 用自己的分词器多算输入而加。坑 65 那套"传 `MAX_SAFE_INTEGER` 再减 4096 反解出估算"的关系从此不成立。

## 解法

`src/budget/estimate.ts` 不再反解：pi 的估算直接从 `@earendil-works/pi-ai/utils/estimate` 的 `estimateContextTokens` 读（`./utils/*` 在 exports 里），允许输出仍取 `clampMaxTokensToContext` 的返回值；`outputAllowance` 照抄上面的算式，测试逐个分支拿它对 pi 的夹紧结果。估算仍封顶在 `窗口 - 4096 - 1`，和反解时的饱和行为一样：阶梯拿字符类别的节省量去减它，拉丁文长上下文的 chars/3.5 不封顶会把裁掉历史后放得下的回合判成拒绝。

按用途的输出下限都不到 32768，这一档里放不放得下和旧算式结论相同，变的只是报出来的允许输出。

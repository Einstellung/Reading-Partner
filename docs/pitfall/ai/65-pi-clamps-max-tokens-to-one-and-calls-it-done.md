# 上下文塞满不报错：pi 把允许输出夹到 1，然后正常 done

## 现象

一次请求里上下文接近模型窗口时，模型只吐一个 token 就停。流照常发出 `done`，没有 error 事件，没有异常，`stopReason` 是 `"length"`。

聊天里看到的是一个字的回复。要解析 JSON 的地方（章节笔记、digest、triage）看到的是"格式错误"——上下文溢出被当成模型不听话的格式问题，往错的方向修。

实测 200k 窗口的模型：pi 估算 190000 → 允许输出 5904；估算 196000 → 允许输出 **1**。

## 原因

`dist/api/simple-options.js` 的 `clampMaxTokensToContext` 在每次请求前把 maxTokens 夹成

```
max(1, contextWindow - estimateContextTokens(context) - 4096)
```

三家 provider 都走这条（`buildBaseOptions` 是公共入口）。下限是 1 而不是 0，所以夹到底的请求仍然合法、仍然发得出去、仍然会得到一个成功的响应，只是响应里只有一个 token。

pi 自带的 `isContextOverflow` 认不出这一种：它要求输出为 0 且输入达到窗口的 99%，这里停在 1 和 97.95%。

第二层：pi 的估算器是 `chars / 4`（`dist/utils/estimate.js`），对中文低估 2.5–4 倍。一本 84.9% 是 CJK 的书，pi 估 55332 token，实际约 125000–180000。也就是说最该收紧的时候它放行。

## 解法

发请求之前自己算一遍同一个数，见 `src/budget/`。

`estimateContextTokens` 没从包根导出，`./utils/*` 也不在 `exports` 映射里，深导入会被拦。但 `./api/*` 在映射里，传 `Number.MAX_SAFE_INTEGER` 能把 pi 自己用的估算值反解出来：

```
estimate = model.contextWindow - clampMaxTokensToContext(model, ctx, MAX_SAFE_INTEGER) - 4096
```

用 pi 自己的数，就不会出现"我们觉得够、pi 觉得不够"。代价是依赖一个非文档化的关系，所以 `tests/budget/estimate.test.ts` 把它钉死了：pi 升级改了安全边或 chars/token，那个测试先红。

在它之上按字符类别再估一遍（CJK 按 1 字符/token），取两者的大值——pi 的数负责和 pi 保持一致，字符类别的数负责中文。

算出 `允许输出 = 窗口 - 估算 - 4096`，低于按用途分档的下限（聊天 4k、章节笔记 4k、digest 8k、overview 16k、plan 16k）就不发，先走 `src/budget/ladder.ts` 的压缩阶梯，压不动就明说处理不了。

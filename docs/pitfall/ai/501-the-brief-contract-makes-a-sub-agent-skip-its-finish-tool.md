# sub-agent 的 brief 合同让模型不调 finish

## 现象

docs/86 的比对里，链接 agent 有 `finish` 工具，系统提示也说「入完了或找不到就调 finish」。Haiku 5.5 一轮 24 次里 13 次不调 finish，最后写一段总结收尾。入库不受影响，回执里没有 AI 的说明。Sonnet 5.5 同样提示 24 次都调了。

## 原因

`runSubagent` 总在定义的系统提示后面接 brief 合同（`legion/subagent/brief.ts`）：「只有你的最后一条消息会返回给调用方，把它写成 brief」。对靠工具交产物、以工具收尾的 agent，这段和自己的提示打架，弱一点的模型照合同写总结。

## 解法

定义设 `briefContract: false`，只发自己的提示（`legion/subagent/types.ts`）。链接 agent 设了，之后 Sonnet 5.5 24 次都调 finish。产物是工具做的事、不是最后那段话的 sub-agent 都该设。

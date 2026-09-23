# lane 不带自己的 prompt 和工具

## 现象

计划里子 agent 是父 harness 上的一条 worker lane：`harness.lane(name, { createAt: tip })` 开出来，换掉模型和工具集，给它自己的角色 prompt。按 pi-agent-core 0.85.1 的 API 做不到后面两件。

lane 上能改的只有三样，`LaneConfiguration` 就这三个字段：`model`、`thinkingLevel`、`activeToolNames`（对应 `setModel` / `setThinkingLevel` / `setActiveTools`）。工具本体和 systemPrompt 都在 `AgentHarnessOptions` 上，是整个 harness 的：`harness.setTools` 一改，所有 lane 跟着改；`activeToolNames` 只能从注册表里挑名字，挑不出没登记的工具。`OperationRequest` 也没有单次覆盖 prompt 的口子。

## 原因

lane 是同一个 agent 在同一份 session 里的并行分支——同一个角色、同一套工具，各自选用哪些、用哪个模型。隔离上下文的子 agent 不是分支，是另一个角色。

## 解法

要自己的 prompt 或自己的工具集，就自己开 harness（`createHarness`，一条临时 session）；身份写在 lane 名和 session 组上（`worker:<name>`，`worker` 组），不写在共用的 harness 配置上。挂父 harness 的 lane 只适合换模型或收窄工具的 worker。

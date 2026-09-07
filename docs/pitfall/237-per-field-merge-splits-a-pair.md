# 逐字段合并会拆散只能成对成立的两个字段

现象：两台设备各自换过 AI 供应商，同步之后 `settings.json` 里出现了谁都没选过的组合——`defaultProviderId` 是 A 设备的 deepseek，`defaultModelId` 是 B 设备的 `qwen-3-235b-a22b`。此后每一次 AI 调用都在 `resolveCall` 抛 `unknown model 'X' for DeepSeek`，重启 app 才好，过一阵又坏。

原因：`settings.json` 走 `fields` 策略（`platform/sync/merge/contract.ts`），每个键独立决定；两边都动过的键由 `chooseByContent` 按内容 hash 定胜负，等于一个键掷一次硬币。供应商和模型是两个键，于是各自掷各自的，拼出一个双方都没有过的对。实测 22 组 deepseek 对其他供应商的合并，10 组回来的对不存在，两个方向都会出现。

合并层没错——它不知道哪些键之间有约束。错在没人在读回来的时候把它修好：`enforceKnownModel`（`ai/model-call.ts`）本来就是干这个的，但只挂在启动那条路（`loadShellSettings`）。同步拉取那条路（`pulledSettings`）把合并后的文件直读直用，坏的对一直留到下次重启。而且必须修到盘上：`resolveModel` 用 `loadSettings()` 从磁盘读，备课、简报、蒸馏、幻灯片这些无人值守的路径看不到 shell 内存里那份改好的。

解法：

- `pulledSettings` flush 完之后走 `loadShellSettings`，修正、写回、把 notice 交出来；`adoptPulledSettings` 像启动那条路一样弹一条 warn toast。两条读盘的路共用同一次修正。
- 合并层不动。也就是说拆散照旧会发生，只是事后被修回来：在一台设备上选了 deepseek 的用户，仍可能在另一台上被换到别家的默认模型，并看到一条说明这件事的提示。
- 一般化的教训：只要一组字段单独取值无意义，`fields` 策略就会拆散它们，嵌成一个对象也不行——嵌套对象照样逐键合并。约束只能在读盘的那一侧兑现，而"读盘"包括同步拉取，不只是启动。

# 逐字段合并会拆散只能成对成立的两个字段

现象：两台设备各自换过 AI 供应商，同步之后 `settings.json` 里出现了谁都没选过的组合——`defaultProviderId` 是 A 设备的 deepseek，`defaultModelId` 是 B 设备的 `qwen-3-235b-a22b`。此后每一次 AI 调用都在 `resolveCall` 抛 `unknown model 'X' for DeepSeek`，重启 app 才好，过一阵又坏。

原因：`settings.json` 走 `fields` 策略（`platform/sync/merge/contract.ts`），每个键独立决定；两边都动过的键由 `chooseByContent` 按内容 hash 定胜负，等于一个键掷一次硬币。供应商和模型是两个键，于是各自掷各自的，拼出一个双方都没有过的对。实测 22 组 deepseek 对其他供应商的合并，10 组回来的对不存在，两个方向都会出现。

解法：合并层认字段组，读盘那侧继续兜它看不见的原因。

- `fieldGroupsFor`（`merge/contract.ts`）按路径声明哪些键必须一起定，和 `strategyFor` 并排；`settings.json` 声明 `defaultProviderId` + `defaultModelId` 一组，别的路径没有组。成员用 `mergeObject` 给 `dropped` 排 id 的那套点号路径写，所以嵌套层里的组也能声明。
- `fields` 把一组键当成一个复合值（只含这些键的子对象，某侧没有的键就是不在），再套 `mergeField` 原本那三条：两侧一样就取，一侧还等于 base 就整组取对面，都动过就交给该文件的 `resolve` 整组定胜负、输的那组逐键进 journal 并置 `contested`。输出的键序不变，赢的那侧没有的成员就继续没有。
- 只有"拆开会拼出不可能存在的状态"的字段才登记。`sttApiBase`/`sttModel` 不登记——`platform/app/settings.ts` 上写着它们自由同步，一侧的 base 配另一侧的 model 名是一种配置，不是矛盾。`PrepState` 的 `planStatus`/`planError` 也不登记：拆开只是让一句提示不匹配，app 照跑。
- `enforceKnownModel` 留在两条读盘的路上（`loadShellSettings` 和 `pulledSettings`），不是冗余：供应商下架的模型、比字段组更老的构建写出的文件，合并层都看不见，这两种照样从拉取进来。两层各管各的，删哪一层都会漏。
- 一般化的教训：`fields` 默认逐键掷硬币，嵌成一个对象也没用——嵌套对象照样逐键合并。要它不拆，得在 `fieldGroupsFor` 里说出来。

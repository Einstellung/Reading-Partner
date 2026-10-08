# pi-agent-core 跟不上 pi-ai：1.0 删了 harness，留在 0.87.1 又会装出第二份 pi-ai

## 现象

2026-10-08 为了让设置里出现新模型，把 pi-ai 和 pi-agent-core 从 0.87.1 一起升到 1.1.0：

- pi-agent-core 1.0.0 把 `AgentHarness`、session、session 存储、lane、`./harness/*` 子路径整个删掉，只剩 `Agent` 和 agent loop。changelog 说挪到了 `@earendil-works/pi-durable`，但那是另一套 API（`Harness.open(storage)`、chord 文档、`submit()`/`wait()`），没有 lane、`OpenOperation`、`JsonlSessionRepo`，`legion/execute` 和 `soul` 整层要重写，盘上的 session 文件格式也不一样。
- 只升 pi-ai、pi-agent-core 留在 0.87.1：`bun add` 之后 `node_modules/@earendil-works/pi-agent-core/node_modules/` 里多出一份 pi-ai 0.87.1。`tsc` 报一个错，在 `src/legion/execute/harness.ts` 把 `Models` 交给 `AgentHarness.create` 那行：两份 `TranscriptContext` 的 `[transcriptContextBrand]` 对不上。测试照样全绿，因为那个 brand 只在类型里，运行期没人查。

## 原因

pi-agent-core 0.87.1 声明 `"@earendil-works/pi-ai": "^0.87.1"`，0.x 的 `^` 只放到 `<0.88.0`，所以 bun 给它单独装一份旧的。harness 内部用旧那份做 `normalizeContext`、估算和重试，我们的 provider 用新那份，同一个回合里两份 pi-ai 各管一半，估算器也是两套（1.1.0 改成了 3.5 字符一个 token，0.87 还是 4）。

## 解法

pi-agent-core 留在 0.87.1，`package.json` 加 `"overrides": { "@earendil-works/pi-ai": "<同 dependencies 里的版本>" }` 压成一份。0.87.1 harness 从 pi-ai 拿的二十来个导出在 1.1.0 全在、签名没变，`skipLibCheck: false` 单独查 pi-agent-core 的 d.ts 也过。

加了 overrides 之后只跑 `bun install` 不够：它回 `no changes`，嵌套那份还在。要 `rm -rf node_modules && bun install`，再看一眼 `node_modules/@earendil-works/pi-agent-core/node_modules` 不存在了才算数。主 checkout 拉到这个改动后照坑 239 再清一次 `node_modules/.vite`。

以后升 pi-ai 时 overrides 里的版本跟着改。等真要换到 pi-durable 是一次单独的设计，不是升依赖。

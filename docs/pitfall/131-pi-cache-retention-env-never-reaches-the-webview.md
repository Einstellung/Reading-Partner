# `PI_CACHE_RETENTION` 在这个 app 里永远读不到：webview 没有 process，Vite 还把 `process.env` 换成了 `{}`

## 现象

pi 的提示词缓存保留期由 `PI_CACHE_RETENTION=long` 打开（5 分钟 ephemeral → 1 小时）。在 shell 里导出它再起 app，不管 dev 还是打包版，请求里都不会出现 `ttl: "1h"`，`usage.cache_creation.ephemeral_1h_input_tokens` 恒为 0。没有报错，也没有任何提示。

## 原因

pi 的 `getProviderEnvValue`（`dist/utils/provider-env.js`）三段：`options.env[name]` → `typeof process !== "undefined" ? process.env[name] : undefined` → bun sandbox 的 `/proc/self/environ` 兜底。后两段在浏览器里都不成立：

- dev（`vite serve`）：预打包产物 `node_modules/.vite/deps/chunk-*.js` 原样保留 `typeof process !== "undefined" ? process.env[name] : void 0`，而 webview 里 `process` 不存在，取值直接跳过。
- 打包（`vite build`）：esbuild 把 `process.env` 整体替换成了空对象字面量（产物里是 `var J={}`，`J[e]` 恒为 undefined）。守卫过不过都一样。

于是只剩第一段：`StreamOptions.env` / `StreamOptions.cacheRetention`。app 两个都没传，`resolveCacheRetention` 每次都落到默认的 `"short"`。

## 解法

要换保留期就在发送路径上传，不要指望环境变量：`src/ai/agent.ts` 的 `runAgentLoop` 里给 `stream(model, context, { ... })` 加 `cacheRetention: "long"`（`streamChatCore` 同理），值从 `import.meta.env.VITE_*` 这类构建期变量来——这个项目的前端配置一律走 `VITE_`（见 `.env.example`）。

同一处还要把同样的值传给 `recordCacheTurn`（`src/platform/app/cache-telemetry.ts` 的 `retention` 字段），否则埋点记的是没发出去的设置。

价格：1 小时保留的 cache write 是基础输入价的 2 倍，5 分钟的是 1.25 倍，cache read 都是 0.1 倍。换成 1h 等于每次写贵 1.6 倍，回本要多读一次。

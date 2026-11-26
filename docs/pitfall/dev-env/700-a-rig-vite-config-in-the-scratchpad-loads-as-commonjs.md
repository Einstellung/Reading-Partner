# 700 放在 scratchpad 里的私有 vite 配置被当成 CommonJS 加载，起不来

## 现象

照坑 142 写了 `rig-vite.config.ts` 放在 scratchpad，在 worktree 根跑 `bunx vite --config <scratchpad>/rig-vite.config.ts`，进程马上退出，日志：

```
✘ [ERROR] "@tailwindcss/vite" resolved to an ESM file. ESM file cannot be loaded by `require`. [plugin externalize-deps]
```

端口不通，`curl` 得到 000。

## 原因

vite 打包配置文件时按配置文件所在目录往上找 `package.json` 的 `"type"` 决定输出格式。项目根的 `package.json` 是 `"type": "module"`，scratchpad（`/tmp/...`）往上没有，于是 `.ts` 配置被打成 CJS，它 import 的 `vite.config.ts` 里的 `@tailwindcss/vite` 是纯 ESM，`require` 不进来。

## 解法

私有配置文件起名 `.mts`（`rig-vite.config.mts`），vite 就按 ESM 打包，内容不用改。

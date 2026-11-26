# 701 worktree 里起的 dev server 报 wasm "expected magic word"，是文件没拷

## 现象

在 agent worktree 里起 vite 做无头截图，一开页面控制台就有两条 error：

```
failed to asynchronously prepare wasm: CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f @+0
Aborted(CompileError: ...)
```

看着像引擎坏了，其实和改动无关。

## 原因

`public/pdfium/`、`public/quickjs/` 的 wasm 被 `.gitignore` 排除，由 `bun run wasm` 从 `node_modules` 拷出来。主 checkout 跑过，新 worktree 没有。vite 对不存在的路径回 `index.html`，`3c 21 64 6f` 就是 `<!do`。

## 解法

要看阅读器就先在 worktree 里 `bun run wasm`；只截设置页、首页时这两条 error 可以忽略，记控制台错误时单独标出来。

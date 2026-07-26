# worktree 里起的 dev server 永远给你旧代码

现象：agent 在 `.claude/worktrees/<name>/` 里跑 `bun run dev`（换个端口），改完源码刷新浏览器，行为纹丝不动。改动明明在磁盘上，`bun test` 也吃到了。会一路量出「修好的代码仍然复现 bug」这种假结论。

原因：`vite.config.ts` 的 `server.watch.ignored` 里有 `**/.claude/**`——那是为了 agent 改文件不要热重载用户主 checkout 的 dev 会话。worktree 自己的路径正好在 `.claude/` 下面，于是这台 dev server 看不见**自己项目**的任何改动：模块图不失效，刷新页面拿到的是 304 和缓存过的转换结果。

解法：worktree 里每次改完源码要重启 dev server（`--force` 顺带清依赖预构建缓存），别指望刷新页面。要连着量多轮，就把「重启 → 导航 → 装探针」写成一个脚本一次跑完。

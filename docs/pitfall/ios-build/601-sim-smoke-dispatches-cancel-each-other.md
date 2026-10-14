# 601 并行分支 dispatch 模拟器 smoke 会互相取消

**现象**：在 `hv/harness` 上 `gh workflow run ios-simulator-smoke.yml --ref hv/harness`，跑了几分钟后结论是 `cancelled`，日志里没有任何报错。同一时间另一个分支 `hv/tts-first-frame` 也 dispatch 了这个 workflow，它的 run 正在跑。

**原因**：`ios-simulator-smoke.yml` 的 `concurrency.group` 写死成 `ios-sim-smoke`，加 `cancel-in-progress: true`。group 不带 ref，所有分支共用一个组，后 dispatch 的那个会把正在跑的取消掉。多个 agent 并行改 Swift、各自要求「推上去跑 smoke 等绿」时必撞。

**解法**：group 改成 `ios-sim-smoke-${{ github.ref }}`，同一分支的新 run 仍取消旧 run，不同分支互不影响。dispatch 用的是 `--ref` 那个分支上的 workflow 文件，所以没合进 main 之前，只有带了这处改动的分支自己不会被别人取消，也不会取消别人。看到 `cancelled` 先 `gh run list --workflow ios-simulator-smoke.yml` 查同时段有没有别的分支的 run。

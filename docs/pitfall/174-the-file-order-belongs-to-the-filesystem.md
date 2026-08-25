# 测试文件的顺序是文件系统给的，一棵树上的全绿不转移

## 现象

同一个 commit（ccaee72），同一台机器，三棵树：

| 树 | 文件系统 | 默认顺序 | seed 23 | seed 47 |
|---|---|---|---|---|
| agent worktree | ext4 `/dev/sda2` | 0 fail | 133 fail | 32 fail |
| 新 clone | ext4 同一块盘 | 0 fail | 133 fail | — |
| 新 clone | tmpfs `/dev/shm` | 7 fail | 48 fail | 47 fail |

每棵树里各自稳定：worktree 连跑两次 seed 23 都是 133，tmpfs 连跑两次默认顺序都是 7，7 个全落在 `tests/observation/profile.test.ts`。tmpfs 那 7 个没有 seed，就是默认顺序。

## 原因

bun 的文件顺序是 readdir 顺序，`--seed` 只是拿这份顺序去洗牌。`ls -U tests` 的头几个和 junit 报告里的头几个一字不差（`sim-bridge` / `shell` / `migrate` / `autostart` / `fulltext` / `sim-bridge-csrf`），tmpfs 上两者同样一致，只是换成了另一串（`preload-gate` / `layering` / `topics` / `topics-store` / `threads`）。

ext4 的目录按文件名哈希读出来，种子在超级块里，所以同一块盘上每棵树的顺序都一样：主 checkout、agent worktree、新 clone，`tests/` 下 40 个共有条目的相对次序完全相同，302 个文件的执行顺序也完全相同。换文件系统就全变——worktree 和 tmpfs 那棵树 302 个位置里 297 个不同，`tests/ui/components/outline-pane.test.tsx` 从 269 挪到 128。

所以"agent 在 worktree 里跑绿了"能推出主 checkout 也绿，推不出 CI 也绿，也推不出换台机器也绿；数字对不上的时候，先分不清是改动错了还是这棵树的顺序恰好合适。

`bun test a b c` 不认参数顺序：五个文件按两种打乱的顺序传进去，两次都按目录顺序跑。要摆顺序只能用 `--seed`。

`Ran N tests across M files` 里的 M 是发现的文件数，N 不是。探针：三个文件，中间那个有 3 个用例、import 一个不存在的导出，链接期就死了，那行写的是 `Ran 5 tests across 3 files`，文件照数，它的 3 个用例换成 1 条合成的 fail。单跑它是 `Ran 1 test across 1 file`，退出码 1。

## 解法

按这个次序，各证各的。

1. `bash scripts/t.sh`，21 秒。证明这棵树这个顺序下没坏。不证明改动和顺序无关，换个文件系统不作数。
2. `bash scripts/t.sh --seed=23`，再换一两个种子。只能和同一棵树改动前的数字比。别人报来的种子失败数不是基线，除非那棵树在同一块盘上。
3. 每文件一进程，带总数闸。三棵树给的答案一模一样，是唯一能转述的一个。

```bash
cd "$(git rev-parse --show-toplevel)"   # 不在根上就没有 preload，见坑 172
ran() { sed -n 's/^Ran \([0-9]*\) tests\? across \([0-9]*\) files\?\..*/\1 \2/p' | tail -1; }
single=$(NO_COLOR=1 bun test 2>&1 | ran); single=${single% *}
sum=0
while IFS= read -r f; do
  r=$(NO_COLOR=1 bun test "$f" 2>&1 | ran)
  [ "${r#* }" = 1 ] || echo "命中不止一个文件: $f"
  sum=$(( sum + ${r% *} ))
done < <(find src tests \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort)
echo "$sum vs $single"
```

两个数字都当场算，一个都不许写死：`tests/fulltext.test.ts` 是 `(existsSync(demoPdf) ? test : test.skip)`，`public/demo.pdf` 不进仓库，有它的树 15 pass，没它的树 14 pass 1 skip。`bun test <路径>` 是子串筛选不是路径，所以顺带断言每次都 `across 1 file`（本仓库 302 个路径没有互为子串的）。

这一趟 66 秒对 21 秒。它证明每个文件不靠别人也能过、且没有文件悄悄少跑用例；证不了文件之间漏没漏，那是第 2 步的事。

## 底账

ccaee72 上这个闸是红的：单进程 3587 个用例，每文件加起来 3561，三个文件单跑起不来，三棵树结果一致。

- `tests/reading/slides/deck-chapters.test.ts`
- `tests/reading/retell/candidates.test.ts`
- `tests/reading/retell/store.test.ts`

都死在 `SyntaxError: Export named 'rename' not found in module '@tauri-apps/plugin-fs'`（坑 119 的模块表）。全量跑的时候前面已经有文件把真模块加载过了，所以三种全量顺序下都看不见。

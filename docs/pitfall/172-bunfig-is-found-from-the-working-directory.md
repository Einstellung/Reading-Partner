# `bunfig.toml` 按当前目录找，从子目录跑 `bun test` 就没有 preload

## 现象

同样两个文件，换个目录跑结论相反。scratch 里放一个 leaker（模块顶层 `spyOn(subject, "value").mockReturnValue("fake")`）和一个 victim（断言 `subject.value()` 是 `"real"`），根目录有配了 `[test] preload` 的 `bunfig.toml`：

```
$ cd gate-probe && bun test tests/z/
 2 pass  0 fail

$ cd gate-probe/tests && bun test z/
error: expect(received).toBe(expected)
Expected: "real"
Received: "fake"
 1 pass  1 fail
```

第二种跑法没有任何提示说 preload 没上。反过来，一个本来就干净的子集这样跑照样全绿，只是什么都没证明。

## 原因

bun 解析 `bunfig.toml` 是按当前工作目录，不往上找项目根。配置找不到，`[test] preload` 就不存在，坑 171 那条全局 `beforeEach(mock.restore())` 整个不装，模块顶层的 spy 又像以前一样漏给后面的文件。`scripts/t.sh` 第一件事是 `cd` 到仓库根，所以正常路径没事；从 `tests/` 或任何子目录直接敲 `bun test` 的人、CI 步骤、agent 都拿到没上闸的一次运行。

`--seed` 只打乱文件顺序，不打乱文件内的用例顺序：seed 1 / 23 / 47 / 2026 / 99999 下三个用例的相对次序不变。

## 解法

`tests/support/gate.ts` 是一个惰性 flag 模块（`markPreloaded()` / `preloadRan()`，自己不跑任何 hook），`tests/support/preload.ts` 加载时调一次 `markPreloaded()`。`tests/preload-gate.test.ts` 只 import `gate`，断言 flag 为真，失败信息写明这次运行没上闸、要从仓库根跑或走 `bash scripts/t.sh`。

flag 不能放 preload 自己身上：测试为了读 flag 去 import `preload.ts` 就会把它加载起来，flag 永远是真。

同一个文件里另有两个用例：前一个装 spy，后一个断言它已经不在——加载了 preload 和还原真的发生是两件事，后者才是别的文件依赖的。

只在选中了这个文件的运行里生效。`cd tests && bun test reading/` 压根不加载它，这是 marker 只放一个文件而不是每个文件的代价。

# pi 的 fork/create 抢 id 一致性用例换了赢家

## 现象

`@earendil-works/pi-agent-core` 从 0.85.1 升到 0.87.1，`tests/platform/app/session-fs.test.ts`
里跑 pi 自带一致性套件的那组红了一条：

```
fork coordination: publishes create when it reserves a shared destination id first
AssertionError: actual "rejected", expected "fulfilled"
```

这条用例先调 `repo.create({ id: "destination" })` 再调 `repo.fork(..., { id: "destination" })`，
要求先调的 create 成功、fork 被拒。0.85 时它是绿的，0.87 反过来：fork 赢，create 被拒。
同一组里镜像的那条（fork 先调）本来是红的、按坑 305 被排除，0.87 反而绿了。

## 原因

destination id 的预订是 repo 自己的内存集合，赢家是先摸到那个集合的那条路径，
而不是先落盘的那条。两条路径在摸到它之前各自 await 了几次文件系统调用，
谁快取决于各自的 await 次数——0.87 改了 create 那侧的顺序，就换了赢家。
文件系统这边什么都没变：本仓的实现一行没动，只换了 pi 的版本。

文件系统背书的 repo 过不了两个方向中的一个。这两条用例是给预订本身是事务的 repo 写的。

## 解法

`NOT_FOR_A_FILESYSTEM` 里排除的名字从 `publishes fork when it reserves a shared
destination id first` 换成 `publishes create when it reserves a shared destination
id first`。仍然按名字排除不按组排除，pi 以后新加的用例照跑。

升 pi 的版本时这一条会再翻面，不要当成本仓文件系统的回归——先按上面的判据确认
是哪条方向红了，再换名字。本应用自己从不 fork session，两个方向都不影响运行。

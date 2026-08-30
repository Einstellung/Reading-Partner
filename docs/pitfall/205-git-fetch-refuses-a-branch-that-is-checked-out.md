# 205 一次性检出的目录里，`git fetch` 拒绝更新正被检出的分支

## 现象

给机器（Mac 构建机）用的一次性检出目录，每次同步新代码时如果停在一个分支名上，用 `git fetch` 更新那个分支会被拒绝。

## 原因

git 不允许 fetch 写入一个正被某个工作树检出的分支，这条限制和 fetch 的来源无关——本地 `git fetch <bundle> refs/x:refs/x` 一样会被挡，不是远程仓库特有的行为。

## 解法

给机器用的一次性检出一律 `git checkout --force --detach <ref>`，别停在分支名上。`scripts/ios-swiftcheck.sh` 每次同步都是先把新提交 fetch 进一个专用 ref（`refs/rp-swiftcheck/head`），再 detach 到那个 ref；检出目录因此从不落在分支上，也就碰不到这条限制。

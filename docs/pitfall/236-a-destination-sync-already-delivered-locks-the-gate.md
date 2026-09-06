# 目标文件已被同步送到，迁移拒绝搬运，全屏闸门再也退不出去

## 现象

0.14.5 的 iPad 上，全屏迁移蒙层怎么点都退不掉。按 Update now，dry run 和 apply 都跑完、不报错，回来是 "The update ran and the old files are still there."，报告里每一条都写着 `observations/m-….md already exists`；Try again 每次一模一样。最后只能删掉 app 重装。

桌面上先跑的那次是好的。

## 原因

两件事叠起来。

迁移第 8 步（`src/migrate/flatten.ts`）把 `memory-<topicId>/` 里的观察搬进 `observations/`，遇到目标文件已经存在就 `refuse` 并把源文件留在原地——按的是「两个版本都是用户自己的记录，挑哪个不是迁移该做的决定」。

而蒙层的判据（`src/memory/observations/legacy.ts` 的 `legacyObservationLayout`）看的是源：`memory-*/` 里还有一个它认识的文件就算老布局还在。

桌面先跑完迁移，几分钟内 `observations/` 整个同步到了 iPad。iPad 再按按钮时，每一个目标都已经在了，于是每一条都被拒绝、每一个源都留下、判据恒为真。观察 id 是全局随机的 `m-<16hex>`，同名就是同一条观察，「目标已存在」是第二台设备同步之后的正常状态，不是冲突。

一句话：拒绝写在了闸门读的那一侧，报告里的一条备注就变成了谁也出不去的锁。

## 解法

第 8 步遇到目标已存在时不再拒绝，源文件一定被处理掉：

- 字节相同（把 topic 按搬运时的写法盖进去之后再比）——源已经没用了，删掉，计 `alreadyMoved`。
- 字节不同——目标一个字节不动，把源的版本按 `m-<id>.conflict-<digest>.md` 停在 `observations/` 旁边（store 本来就认这种名字），再删源，计 `parkedAsConflict`。后缀取自内容的 digest，重跑落到同一个文件名，不会越跑越多。
- 源本身就是冲突副本时同样处理：相同就删，不同就换一个按自己字节算的后缀。

迁移仍然不替用户挑版本，两份都留着；变的是它绝不留下源文件。

一般规则：闸门读哪份数据，处理那份数据的代码就不许有「跳过」这条出路。留一份带备注的残留在别处是可读的报告，留在闸门读的那一侧就是死锁。

# 抢触摸的那个阈值不是距离：浏览器给你的第一个 touchmove 已经越过它自己的 slop

## 现象

给手机外壳的下拉手势定"多少像素开始抢触摸"（坑 70 的做法，非 passive `touchmove` 里 `preventDefault`）时，实测发现这个数在很大一段区间里完全不起作用。

滚动容器停在顶部，下拉 150px，每 2px 一个 move、间隔 16ms：

| 抢的阈值 | 结果 |
|---|---|
| 1 / 3 / 5 / 8 / 10 / 16 px | `pointerdown → pointerup`，手势跑完，容器没滚 |
| 20 px | `pointerdown → pointercancel` |

把手指加快到每 12px 一个 move：1–20 px 全都抢得住，30 px 才失手。

页面拿到的第一个 `touchmove`，前一种速度下 dy 已经是 16，后一种是 24。

## 原因

Chromium 在触点越过它自己的 touch slop 之前不派发 `touchmove`。所以"阈值"能不能抢到，取决的不是这个数本身，而是它有没有小到能被**第一个送到手里的 move** 满足 —— 第一个 move 就是浏览器决定这次触摸归谁的那一下，错过它，后面全是 `pointercancel`。手指越快，第一个 move 的位移越大，能"侥幸"通过的阈值区间就越宽，所以这个数按某次实测调出来的值在真机上不成立。

坑 70 记的横向 "3px 抢得住、10px 已经晚了" 是同一件事的另一面：那次的手指更慢，第一个 move 的位移落在 3 和 10 之间。

抢失败在控制台里的样子是一条 intervention：`Ignored attempt to cancel a touchmove event with cancelable=false, for example because scrolling is in progress and cannot be interrupted.` —— 收到它就说明这一序列已经判给滚动了。

## 解法

不要把它当成"手势多灵敏"的调参，当成一条硬约束：**取一个小到任何一个可能的第一个 move 都能满足的数**，然后在第一个满足方向条件的 move 上就抢，并且这一序列的每个 move 都继续 `preventDefault`（只抢第一下照样 `pointercancel`，坑 70 已记）。纵向和横向都取 3px（`TOUCH_CLAIM_PX`），理由是它远低于任何浏览器的 slop，而不是因为 3 这个数被单独调出来过。

代价是抢得比手势自己的判据（`SLOP = 10`）早：3–10px 的下拉会先把这次触摸从滚动那里拿走，之后手指改成向上滑，这一次就滚不动了。在顶部这只影响"小幅下拉又改主意"，下一次触摸正常。

## 范围

Chromium（headless，`Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`）实测。WebKit 派发 `touchmove` 比 Chromium 早（没验），那边第一个 move 的位移更小，正是"取小数"这条结论在真机上兜底的地方。

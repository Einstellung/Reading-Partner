# 290 — 带 rAF 循环的页面永远等不到 networkidle

## 现象

`page.goto(url, { waitUntil: 'networkidle' })` 在 `/orb-spike.html` 上一定超时，30 秒后 TimeoutError，
页面其实早就画好了。

## 原因

两条都不断：vite dev server 的 HMR websocket 一直连着，算一条活着的连接；页面自己的 rAF 循环每帧都在跑。
networkidle 的判据是「500ms 内不超过 2 个网络连接」，长连接把它顶住。

## 解法

`waitUntil: 'domcontentloaded'`，然后 `waitForSelector` 等自己认识的那个元素，再按需要 `waitForTimeout`
等动画进入想截的那一帧。任何有常驻动画或 HMR 的页面都别用 networkidle——它在这个仓库里没有能成立的场合。

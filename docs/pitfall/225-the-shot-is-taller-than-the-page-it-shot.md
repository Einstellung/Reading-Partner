# 无头截图比它拍的那一页高 87px

## 现象

按 `--window-size=1194,834` 拍外壳的整屏探针，PNG 确实是 1194×834，但 `absolute inset-0` 的页面和 100vh 的侧栏都在 y=747 就断了，底下 87px 是一条纸色的空带。看着像页面没占满高度、或者 flex 少了一层 `h-full`。

## 原因

视口比 `--window-size` 矮 87px，宽度不差。这台机器上（`/usr/bin/google-chrome` 144.0.7559.132，2026-09-06 实测）：

```
--window-size=1194,834  →  inner=1194x747
--window-size=834,1194  →  inner=834x1107
```

截图画布是外窗尺寸，视口之外那一截由浏览器拿页面背景补上，所以它不是黑边也不是透明，一眼看不出是空的。坑 220 里「这台机器上视口高度已经等于 window-size 的高度」是错的，那句已经改掉。

量的办法：一页把 `innerHeight` 写进 DOM，`--dump-dom` 取回来。

```bash
google-chrome --headless=new --no-sandbox --disable-gpu \
  --window-size=1194,834 --virtual-time-budget=3000 --dump-dom file://$PWD/vh.html
```

## 解法

要拍满 H 的视口就传 `H+87`。不改窗口的话，只把 PNG 顶上的 `H-87` 当页面看，底下那条不算数——判断某个东西是不是被切掉了，先减这 87px 再说。

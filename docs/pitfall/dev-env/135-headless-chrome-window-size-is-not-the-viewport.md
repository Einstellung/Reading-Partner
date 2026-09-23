# 无头 Chrome 的 --window-size 不是视口，截图会少一截

## 现象

要在不弹窗口的前提下看渲染效果（CLAUDE.md：绝不在用户屏幕上开窗），做法是把图渲染成 SVG 落盘，再用 `google-chrome --headless=new --screenshot` 截成 PNG 自己看。按图的自然尺寸传 `--window-size=352,739`，出来的 PNG 确实是 352×739，但底部约 11% 是空白——图最下面那个节点没了。

一开始以为是布局把节点放到画布外，去查 `frame()` 的边界计算，其实布局是对的：SVG 文件里那个 `<rect y="675">` 好好地在 viewBox 里。

## 原因

`--window-size` 给的是**外窗**尺寸，`--headless=new` 仍然按有窗口边框算，视口比它矮。直接量出来：

```
--window-size=352,739  →  {"dpr":1,"iw":500,"ih":652,"ow":500,"oh":739}
```

高度被吃掉 87px，宽度还有个 500px 的下限（352 被抬到 500）。截图截的是视口，所以超过 652px 的内容根本没进画面。

另外主机若有缩放，`devicePixelRatio` 会再叠一层——第一次量到 739 里只画了 660，就是 DPR 1.12 和窗口边框一起造成的。

精确数字（这台机器上 `/usr/bin/google-chrome` 144.0.7559.132，2026-09-06 实测）：

```
--window-size=1194,834  →  inner=1194x747
--window-size=834,1194  →  inner=834x1107
```

高度恒差 87px，宽度不差（只受下面那条 500px 下限管）。截图画布是外窗尺寸，视口之外那一截由浏览器拿页面背景补上，不是黑边也不是透明，一眼看不出是空的。量的办法：一页把 `innerHeight` 写进 DOM，`--dump-dom` 取回来：

```bash
google-chrome --headless=new --no-sandbox --disable-gpu \
  --window-size=1194,834 --virtual-time-budget=3000 --dump-dom file://$PWD/vh.html
```

要拍满 H 的视口就传 `H+87`。不改窗口的话，只把 PNG 顶上的 `H-87` 当页面看，底下那条不算数——判断某个东西是不是被切掉了，先减这 87px 再说。

## 解法

把窗口开得比画面大，让 PNG 是「多留白」而不是「被裁掉」，并显式钉死缩放：

```bash
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=1 \
  --screenshot=out.png --window-size="$((W>500?W:500)),$((H+100))" wrap.html
```

`wrap.html` 是一层 `margin:0;padding:0` 的包装页，SVG 用 `display:block`，否则还会被页面默认边距再挪一点。

要看某一条横带（确认底部到底画没画）就把包装页里的容器 `position:absolute; top:-<offset>px` 推上去，再按带高截。

顺带：`--dump-dom` 输出是一整行，要从里面取数据（比如在页面里用 canvas `measureText` 量真实字宽再回来校准估算表），把结果塞进 `document.title`，用 `sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p'` 取，比 grep body 稳。

## 同一个坑的另一张脸：手机宽度的图是裁出来的，不是按那个宽度排的

按上面这条拍手机首页，`--window-size=390,944`。PNG 确实是 390×944，看着也像手机——但右边整条没了：设置齿轮不见了，简报卡的一行字被切断在中间。把同一页在浏览器里缩到 390 宽，换行位置完全不同。

原因是那条「宽度有 500px 下限」不是把图放大，是把**视口**抬到 500：页面按 500px 排版，截图只截了左边 390px。所以不是排版没做，是量到的排版是另一个宽度的。

解法：窗口开到 500 以上，把要量的形态包在一个定宽盒子里，让 CSS 按盒子的宽度排：

```tsx
<div className="h-full w-[390px] overflow-y-auto bg-background">
  <PhoneHome … />
</div>
```

```bash
--window-size=500,944
```

只对不看视口宽度的组件成立。里面有 `sm:` / `lg:` 这类断点的，断点仍按真视口（500）判，这么量出来的是假的——那种要么真开 500 宽的窗口去量 500，要么用 devtools protocol 的设备模拟。

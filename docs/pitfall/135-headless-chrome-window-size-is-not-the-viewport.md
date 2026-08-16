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

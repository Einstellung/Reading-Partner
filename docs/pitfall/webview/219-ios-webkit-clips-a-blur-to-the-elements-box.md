# iOS WebKit 把 blur 滤镜裁在元素自己的盒子上，模糊的光晕画出一个硬边方块

## 现象

orb 的光晕是一个 `rounded-full` 的圆，`bg-primary/30` 加 Tailwind 的
`blur-2xl`（`filter: blur(40px)`），外扩 `inset-[-25%]`。桌面上看着是团光，
iPad Pro 11-inch (M5) 模拟器（iOS 26.5，Tauri 的 WKWebView）里截出来是一个
边缘清晰的紫色方块，尺寸正好是那个元素的盒子（160px 的球外扩 25% = 240px）。

## 原因

滤镜的输出被裁在元素的边框盒上。CSS Filter Effects 规定 filter region 要超出
盒子（模糊要向外扩散约 3σ），WebKit 这里没扩：`border-radius` 只裁背景，不裁
滤镜结果，于是模糊出来的方形余晖照原样留在盒子里，盒子边界成了硬边。

同一段 CSS 在 Linux 的 WebKitGTK 和桌面 Chromium 上都是圆的，所以这条只有在
真 iOS webview 里能看见。

## 解法

不要用 filter 做光晕，用径向渐变自己淡出：

```
bg-[radial-gradient(circle,var(--color-primary)_25%,transparent_62%)]
```

渐变是背景绘制，不经过滤镜管线，也就没有裁剪区这回事。透明度照旧由
`opacity-(--orb-glow)` 每帧写。

范围：只量了 blur。其它 filter（`drop-shadow`、`saturate`）会不会同样被裁没
试过。

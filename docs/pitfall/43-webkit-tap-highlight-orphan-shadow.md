# 关掉 preflight 会连带丢掉 tap highlight 的关闭，点完即消失的按钮留下孤儿阴影

## 现象

iPad 上在标注弹层里点 Delete，划线删掉之后，按钮原来的位置有一小块深色圆角阴影一闪而过。位置和大小严格等于被点的那个按钮。

## 原因

`-webkit-tap-highlight-color` 的默认值不是透明。WKWebView 的点击高亮不是网页渲染层画的，是原生层按点击时刻的 border box + border-radius 画的遮罩，有自己的最短显示和淡出时长，DOM 元素被移除它不会跟着走。

平时按钮点完还在原地，这个高亮就是正常的按下反馈，看不出问题；只有"点一下自己就消失"的控件（标注弹层的 Delete 和关闭、More 菜单里点一项就收起）才会露出无主的阴影。

项目只引 Tailwind utilities 不引 preflight，而 `-webkit-tap-highlight-color: transparent` 正是 preflight 里的一条规则（`node_modules/tailwindcss/preflight.css`），于是全 app 的系统点击高亮一直开着。

## 解法

`src/styles.css` 的全局块里加：

```css
html {
  -webkit-tap-highlight-color: transparent;
}
```

需要按下反馈的控件用 `active:` 声明（`active:bg-black/5`），它跟着元素一起卸载，不会留残影。

顺带：hover 类要走项目的 `can-hover:` 前缀，否则触摸端会吃 sticky hover。

# 划出来的颜色和重开之后的颜色是两回事：渲染读 strokeColor，不透明度分两处

## 现象

用浅黄色划一条高亮，屏幕上出来的是深黄色；书关掉再打开，同一条变成浅黄色。也就是刚划的那一下颜色偏深，重开之后才是"真实的"颜色。

在 spike harness 里量到的两条 DOM（同一份颜色 `#ff6666`）：

```
刚创建：background: rgb(255, 205, 69); opacity: 1;     // #FFCD45，插件自己的默认黄
重开后：background: rgb(255, 255, 0);  opacity: 0.4;   // #FFFF00，渲染器的兜底黄
```

两边都不是 `#ff6666`。壳存进 JSON 的 `color` 一直是对的，错的只是画出来的那一下。用户只用过黄色，所以颜色错得看不出来，只剩"深"和"浅"的差别浮在表面。

## 原因

两件事叠在一起。

一，`PdfHighlightAnnoObject` 上 `color` 已经是 deprecated 别名，渲染器读的是 `strokeColor`（`Highlight` 组件里 `strokeColor ?? "#FFFF00"`）。壳的 `zoteroToEmbed` 只写 `color`，于是重开后每条高亮都画成兜底的纯黄；`setColor` 只 patch `color`，于是刚创建的那条留着工具默认的 `strokeColor: "#FFCD45"`（下划线是 `#E44234`）。

二，不透明度有两个来源。壳的 JSON 不存 opacity，`convert.ts` 重新载入时写死 0.4；创建走的是插件的工具默认值，实测 highlight 和 underline 都是 1：

```js
AnnotationPluginPackage.initialState(null, {}).tools
// highlight {"strokeColor":"#FFCD45","color":"#FFCD45","opacity":1,"blendMode":1}
// underline {"strokeColor":"#E44234","color":"#E44234","opacity":1}
```

`textMarkupSelectionHandler` 建标注时是 `{ ...tool.defaults, rect, segmentRects, ... }`，工具默认值原样进对象。mixBlend 两边一致（渲染器给 highlight 的 `defaultBlendMode` 就是 Multiply，对象带不带都一样），所以差别全在这两项上。

## 解法

`convert.ts` 拿一个 `MARKUP_OPACITY`，两条路都从它取：导入路径直接用，创建路径靠注册期的 `tools` 覆盖把插件的工具默认值改成同一个数（按 `id` 深合并进插件自己的默认值，别的字段不动）。

```ts
createPluginRegistration(AnnotationPluginPackage, { tools: MARKUP_TOOL_OVERRIDES })
```

颜色一律走 `markupColorPatch(color)`，同时写 `color` 和 `strokeColor`——`setColor`、`updateAnnotation`、`upsertAnnotations` 三个写入点都要；读回来走 `markupColorOf`，`strokeColor` 优先、`color` 兜底（老数据只有 `color`）。

盘上已有的标注不受影响：它们本来就按 0.4 画，改的是创建那一下向它们看齐。

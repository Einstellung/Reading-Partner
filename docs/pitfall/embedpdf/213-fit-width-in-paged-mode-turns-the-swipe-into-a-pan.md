# 翻页模式下按「Fit page width」以后就翻不动页了

现象：iPad 上把阅读器切成翻页（paged），再从顶栏 More 菜单里点 "Fit page width"。页面看着只是变大了一点，但从此左右滑动只是在页面里平移，怎么划都不翻页。要恢复只能再切一次布局。

原因：菜单项是"重置缩放"，实现却写死成一个具体的 fit。`view.zoomReset()` 一路映射到 `requestZoom(ZoomMode.FitWidth)`，不看当前布局。竖屏下一页 A4 按宽度适配比按整页适配大（高度超出屏幕），于是 `refreshZoomedIn()` 看到 `currentZoomLevel > fitPageScale * 1.02`，判定"读者放大了"，把 `pagedRef.current.zoomedIn` 置为 true——这正是捏合放大后该有的行为：放大的页要能平移，横滑于是归平移不归翻页。捏合缩回去会自动复位（`refreshZoomedIn` 在缩回 fit-page 时重新锁 FitPage），但这条路进来的放大没有"缩回去"的动作，状态就一直留着。

`canZoomReset` 当时在 `EmbedReaderPane.tsx` 里写死 true，所以这个菜单项在任何时候都是可点的，包括已经在目标 fit 上时。

解法：重置就是回到"该布局自己锁的那个 fit"，这个判断是纯函数 `resetZoom(layout)`（`src/reading/engine/layout-modes.ts`，取 `LAYOUT_SETTINGS[layout].zoom`），竖排 fit-width、翻页 fit-page。`wire-engine.ts` 的 handle 上是一个 `zoomReset()`（原来的 `fitWidth`/`fitPage` 两个方法只有这一个调用点，合掉了），翻页模式下它在请求完 FitPage 之后还要 `refreshZoomedIn()` + `settleLayout("paged", targetedPage(), "instant")`：掉一档缩放整条页带都要重排，落点得等几何（坑 56）。菜单标签跟着布局走（`zoomResetLabel`，翻页时叫 "Fit page"），`canZoomReset` 由 `atResetZoom(layout, 当前 zoomLevel)` 算出来——数字（捏合留下的）永远不算 reset。键盘的 Ctrl/Cmd+0 原来靠 `setLayout("paged")` 绕过这个坑，现在也走 `zoomReset()`。

同一个形状的错还可能从别处再来一次：任何"重置/适配"的入口都不许自己挑 `ZoomMode`，只能问布局。

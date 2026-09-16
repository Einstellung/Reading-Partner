# 333 idb 送不出「按住再拖」，要走 XCUITest

## 现象

手机重排视图的长按划线可以按 `ios-sim.sh press` 验（按住 0.9 秒落一条单词高亮），拖动延长那一半验不了：`press` 只按不动，`swipe` 一落手就动，视图把它当滚动。两条命令拼起来也不行——第二条是新的一次触摸。

## 原因

idb 的 HID 通道一次描述一个接触点的一种行为：按住不动，或者按某条轨迹移动。它没有"按下、停住 N 秒、再沿轨迹移动、然后抬手"这种一笔写完的序列，而 WebKit 的手势仲裁正是按这一笔的时间形状决定把这串触摸给谁的。

## 解法

走 `scripts/ios-sim/GestureDriver`（pinch 用的那个 UI-test bundle）：`XCUICoordinate.press(forDuration:thenDragTo:)` 正好是这一笔。新加的 `ios-sim.sh press-drag <x1> <y1> <x2> <y2> [hold]` 把点坐标交给 bundle，bundle 按 window 的尺寸折成 XCUICoordinate 要的归一化偏移，所以调用方和其它命令说同一套坐标。

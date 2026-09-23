# 332 往 Mac 上的 checkout 里拷任何一个文件，模拟器里的界面就回到首页

## 现象

手机壳在模拟器里已经翻到书的第 14 页，准备驱动下一个手势。`scp` 把改过的 `scripts/ios-sim.sh` 和 `GestureDriver/Tests/GestureTests.swift` 推到 Mac 的 checkout，然后照着刚才记下的坐标点下去——点在了首页的简报卡上，接着的 `press-drag` 在首页的"All topics"上拉出了系统选区条。截图才看出来：app 已经回到首页了。

## 原因

`tauri ios dev` 的页面是 vite dev server 服务的，vite 监听的是整个项目根目录，不只是 `src/`。脚本文件不在模块图里，没有 HMR 边界可用，vite 就整页 reload。手机壳的导航栈是 React state，整页 reload 等于回到 `INITIAL_STACK`。

## 解法

驱动界面的过程中不要往 Mac 的 checkout 里写任何文件。要改驱动脚本就先改完再进界面；非改不可就当作"这一次驱动作废"，重新导航到该到的屏。

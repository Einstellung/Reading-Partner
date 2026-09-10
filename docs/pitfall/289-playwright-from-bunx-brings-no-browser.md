# 289 — bunx 拉来的 playwright 和机器上已有的浏览器对不上号

## 现象

无头截图脚本 `chromium.launch()` 直接抛：

```
browserType.launch: Executable doesn't exist at
/home/xinyuan/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
```

而 `~/.cache/ms-playwright/` 里明明有 `chromium-1234`、`chromium_headless_shell-1234`、`webkit-2336`，都带
`INSTALLATION_COMPLETE`。`bunx playwright@1.55.0` 和 `bunx playwright@latest` 两个版本都失败，报的是两个不同的
revision 号。

## 原因

playwright 把浏览器版本钉死在 npm 包版本上，找的是 `chromium_headless_shell-<该版本自带的 revision>` 这一个目录，
不存在就报错，不会退而用 cache 里已有的别的 revision。`bunx` 每次拉的是当天的最新包，revision 跟着变；机器上那份
是以前某次 `playwright install` 装的。仓库自己不依赖 playwright，`node_modules` 里没有，所以永远走 bunx 这条路。

## 解法

不要 `playwright install`（几百 MB，而且下次 bunx 换版本又对不上）。launch 时显式指路：

```js
const b = await chromium.launch({
  executablePath: '/home/xinyuan/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
})
```

先 `ls ~/.cache/ms-playwright/` 看有哪些 revision，挑一个 headless shell。协议层是向后兼容的，1.63 的
playwright 驱动 1234 的 shell 没问题。

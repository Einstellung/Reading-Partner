# 624 浏览器里的 dev 页面没有盘，盒子和门口对话一项都写不进去

## 现象

无头 Chromium 打开 `vite` 起的 dev 页面（不在 Tauri 里），外壳能画出来，但往盒子里放项（`appBox().put`）直接抛 `Cannot read properties of undefined (reading 'invoke')`；角上永远没有公文盒，门口对话打不开当天的线程。

## 原因

`platform/app/appdata.ts` 只走 Tauri 的 fs 插件，插件读的是 `window.__TAURI_INTERNALS__.invoke`，浏览器里没有这个对象。原子写更不走插件，是自定义命令 `write_text_file_atomic`（`{ path, contents }`），只模拟插件的 `plugin:fs|*` 也写不进去。

## 解法

页面加载完以后（不是之前：之前装上 `isTauri()` 从启动起就为真，外壳会走宿主分支）往 `window.__TAURI_INTERNALS__` 塞一个内存版：`invoke` 认 `plugin:fs|exists / read_text_file / read_file / write_text_file / write_file / mkdir / read_dir / remove / rename / stat` 和 `write_text_file_atomic`，别的命令回 `null`；再给 `transformCallback`、`metadata`。读文件要回数字数组（插件自己 `Uint8Array.from` 再解码），`write_text_file` 的路径在第三个参数的 `headers.path` 里，URI 编码过。装好之后用 `page.evaluate(() => import('/src/box/index.ts'))` 拿到和页面同一份模块去放项、`import('/src/soul/index.ts')` 和 `/src/platform/app/threads.ts` 去写当天的门口线程，盒子的 subscribe 会让角上立刻读到。2026-10-15 卢明对话窗改版的截图就是这么拍的。

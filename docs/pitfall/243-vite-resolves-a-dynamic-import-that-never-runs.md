# vite 会解析永远跑不到的那条分支里的动态 import，解析不到就整个模块报错

## 现象

把 foliate-js 的 EPUB 那条路拷进 `vendor/foliate-js/`，只拷 EPUB 用得上的九个文件。请求 `/vendor/foliate-js/view.js`，vite 回一个错误页：

```
Failed to resolve import "./vendor/zip.js" from "vendor/foliate-js/view.js". Does the file exist?
```

出错的那行在 `makeBook()` 里，是 `await import('./vendor/zip.js')`。这个函数一次都不会被调用——book 对象是我们自己造的，`view.open(book)` 收到的是对象不是文件，`makeBook` 的整个分支树（CBZ / FB2 / PDF / MOBI）都碰不到。模块照样加载失败。

## 原因

`vite:import-analysis` 在 transform 阶段扫模块，静态 import 和**带字面量的动态 import 一视同仁**：它要把 specifier 改写成自己的 URL，所以必须先解析。解析不到就是 transform 失败，整个模块变成错误页。运行时会不会走到那一行，它无从判断，也不打算判断。

`await import(someVariable)` 不受影响——那种它改写不了，也就不解析。

## 解法

七个文件（`comic-book.js`、`fb2.js`、`pdf.js`、`mobi.js`、`tts.js`、`vendor/zip.js`、`vendor/fflate.js`）都在 `vendor/foliate-js/` 里存在，内容是几行抛异常的桩，见 `vendor/foliate-js/unsupported.js`。

存桩不删分支，是为了 `view.js` 与上游逐字节相同：下一版 foliate-js 才 diff 得进来。

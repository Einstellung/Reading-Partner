# 模板在注释里又写了一遍自己的占位符

## 现象

`fetchPageViaWebview` 传一段多行脚本，脚本必定失败。WKWebView 报
`SyntaxError: Return statements are only valid inside functions.`，
换成把同一段脚本压成一行，同样的页面同样的选择器，立刻返回结果。
meals 的 Bing 图片搜索（`BING_RESULTS_SCRIPT`，多行模板字符串）一直走的是
`parseBingImages` 解析 html 的兜底路径，没人察觉。

## 原因

`src-tauri/src/webview_fetch/script.js` 是个模板，Rust 侧
`include_str!("script.js").replace("__RP_SCRIPT__", script)` 把调用方的脚本塞进去。
`replace` 换的是全部出现处，而文件顶上那句解释占位符的注释里也写了一遍
`__RP_SCRIPT__`。于是调用方的脚本被复制了两份：一份在代码里（对的），一份在
`//` 注释里。注释只管到本行行尾，多行脚本的第二行就落到页面顶层，
`return out;` 于是不在任何函数里。

一行的脚本整段都待在注释里，什么都不会发生——所以这个坑只在多行脚本上出现，
而唯一那条单测传的正是 `"1 + 1"`。

## 解法

模板里占位符只准出现一次，注释里改成「下面那个占位符」这种说法，不写它的名字。
护栏是 `page.rs` 的 `the_wrapper_names_the_placeholder_once` 和
`the_wrapper_keeps_a_multi_line_script_in_one_piece` 两个测试。

看见这个错误能一眼认出来，靠的是 WKWebView 的 `NSError` 里
`WKJavaScriptExceptionMessage` 那一项；`localizedDescription` 只说
"A JavaScript exception occurred"，什么也没说。`eval_string` 的 macOS 分支
现在两个都带出来。

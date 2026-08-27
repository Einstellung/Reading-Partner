# `Info.ios.plist` 在构建期合并，init 完 grep `gen/apple` 是假阴性

现象：`tauri ios init` 生成出来的 `gen/apple/reading-partner_iOS/Info.plist` 里，`Info.ios.plist` 的 key 一个都没有，看起来像配置没生效。

原因：合并发生在构建时，不在 init 时。

解法：要验就验构建产物 `.app/Info.plist`。邻居一条：自定义 URL scheme 同样是构建期才写进 Info.plist（坑 31）。

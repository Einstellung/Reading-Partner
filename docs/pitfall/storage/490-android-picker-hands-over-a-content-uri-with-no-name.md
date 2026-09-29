# Android 的文件选择器给的是 content:// URI，末段不是文件名

## 现象

Android 手机上用书架的 Import 导入一本 EPUB，书能读、能同步，桌面书架上它叫 `document:2905a…`；桌面点开报「打不开这个文件——可能已被移动或删除」。

## 原因

`@tauri-apps/plugin-dialog` 的 `open()` 在 Android 上返回 SAF 的 `content://…/document/document%3A2905a…`，不带文件名，也没有别的字段给名字。`normalizeFilePath` 只认 `file://`，这条 URI 原样当路径存下，`basename` 切出 `document%3A2905a`，读取时的 `decodeLegacyName` 再把 `%3A` 解成 `:`。fs 插件在手机上能按这条 URI 读字节，所以导入本身没症状；另一台设备拿这条路径什么也读不到。

## 解法

导入时路径是 `file://` 以外的 URL，名字取 EPUB 自己的 `dc:title` 加 `.epub`（`import-book.ts` 的 `nameForOpaquePath`），写进 `library.json` 的 title 和 topics 行的 name；路径照旧存 URI。桌面打开一本库里没有的书，路径读不到而 book id 已知时当场 `fetchBook`（`open-file.ts`），不靠这条路径。已经以 `document:…` 落盘的行不自愈，删掉重导。

# iOS 给的不是路径，是 percent-encoded 的 file:// URL

## 现象

在 iPad 上通过分享单把一本中文 PDF 导入 app，书名在书架、话题文件列表、笔记面板里全是

```
%E5%85%A8%E7%90%83%E8%A7%86%E9%87%8E%E4%B8%8B%E7%9A%84%E6%8A%95%E8%B5%84%E6%9C%BA%E4%BC%9A%20...
```

书能正常打开、能同步，只有名字是乱的。桌面上导入同一本书没事。

## 原因

文件选择器在 iOS 上返回的是

```
file:///private/var/mobile/Containers/Data/Application/<UUID>/tmp/<bundle-id>-Inbox/%E5%85%A8%E7%90%83....pdf
```

——带 scheme、且整条路径被 percent-encode 过；桌面返回的是普通路径。`basename()` 直接切最后一段，切出来的就是编码串。fs 插件两种形态都能读（`FilePath` 认 URL），所以除了名字没有任何症状。

这个编码串随即被抄进三处落盘数据：`library.json` 的 `title`/`originalFilename`、`topics.json` 的 `files[].name`（`path` 本身就是那条 URL）、`notes-<bookId>/state.json` 的 `bookName`（它还会进章节提示词，模型被告知这本书叫 `%E5%85%A8...`）。bookId 是内容 sha256，不受影响。

## 解法

归一化收在路径进入系统的那道门：`topics.ts` 的 `addFileToTopic`。`importBook` 的路径参数一律来自已存的 `FileRef.path`，不是第二道门。规则在 `platform/app/path.ts`：

- 只有自称 `file://` 的串才解码。普通路径原样返回，`/home/x/50%.pdf` 不会被动。
- 逐段解码，畸形转义（`%zz`、`%E5%`）只让那一段保留原文，不让导入失败。
- `file:///C:/...` 去掉盘符前的斜杠；`file://server/share` 保留成 `//server/share`。

已落盘的脏数据在读取时自愈，不做一次性 migration：`healTopics` / `healLibrary` 是纯函数，没东西可修时返回**同一个对象**，调用方据此跳过写入。启动时各跑一次 `repairTopicPaths()` / `repairLibraryNames()`，干净的库一个字节都不写——这两个 JSON 是整文件 LWW 同步单位，每次启动多一个 rev 就是让另一台设备白拉一次（坑 53）。笔记的 `bookName` 在 `normalizeNotesOnLoad` 里顺手解码，不额外触发写。

名字的自愈只认"确实像编码产物"的串：全为可打印 ASCII、不含空格、至少有一处 `%XX`，且解码结果不含路径分隔符。带空格或中文的名字本来就是好的，一律不动。

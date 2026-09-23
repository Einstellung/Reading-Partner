# 331 形状不对的 library.json 会被改名搬走，界面上只看到一个空书架

## 现象

往 iPhone 模拟器的 app 容器里放种子数据验手机书架：`topics.json` 写对了（书架列出 1 个 topic、4 个文件，封面也渲染出来），但首页 Library 卡上没有续读那一行，`materialTap` 把每张卡都当 PDF。重启也一样。回头看容器，`library.json` 不见了，旁边多了一个 `library.json.corrupt-1789554213293`。

## 原因

`library.json` 存的是 `LibraryStore`，即 `{ "books": { <bookId>: entry } }`，不是 `{ <bookId>: entry }` 的扁平表。种子写成了扁平表，守卫读到形状不对的文件，按规矩把它改名成 `.corrupt-<时间戳>` 留证，然后当空库继续跑——所以没有报错，只有一个什么都不知道的书架。`entries` 为空时 `shelfMaterials` 的 `format` 默认成 pdf，封面却照常渲染（封面走 `covers/`，不查注册表），于是界面看着"有书"。

## 解法

种子按 `{"books": {...}}` 写。喂完数据先看一眼容器里有没有 `*.corrupt-*`：那是守卫在说这份文件它没认出来，比看界面快。

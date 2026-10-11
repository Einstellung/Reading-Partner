# 537 tauri ios dev 开着时切代码，模拟器里的 app 被重装、换容器、用新代码起来

## 现象

Mac 上 `~/rp-flow` 的 `tauri ios dev` 还在跑，把工作区切到新提交（还没杀旧 dev server）。几十秒后模拟器 app 被重启，`simctl get_app_container` 给出的容器 UUID 变了（数据跟过去了），前端由旧 vite 发新源码。之后每次重起 dev server 都再换一次 UUID。

## 原因

`tauri ios dev` 监听 `src-tauri/`，切代码改到了 Rust 侧文件就触发增量编译、重装、重启 app。重装让模拟器把数据容器挪到新 UUID。旧 vite 不在 `.claude/` 下，照常把新源码发给它，但没带新进程该有的环境变量（如 `VITE_VERIFY_FAUX`）。

## 解法

先按 PID 杀掉 dev server 和它的 vite 子进程，再切代码，再起新的。容器路径不要缓存，每步用 `simctl get_app_container` 现取。要验「新代码首次启动」的事（如 `finishOldSoulSession`），切代码前先把相关目录拷一份，切完核对它有没有在旧 dev server 那次重启里被动过。

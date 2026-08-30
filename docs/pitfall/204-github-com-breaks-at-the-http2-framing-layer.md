# 204 Mac 到 github.com 在 HTTP/2 层就断，包解析看着像卡死

## 现象

Mac 上直接 `git clone`/`git fetch` github.com 报错：

```
fatal: unable to access 'https://github.com/...': Error in the HTTP2 framing layer
```

SwiftPM 和 xcodebuild 解析包依赖时撞上同一条网络故障，不会立刻报错——会先重试约三分钟才失败，中途没有任何输出，看起来像是卡死在某一步。

## 原因

这台 Mac 到 github.com 的路径在 HTTP/2 帧层面就断了。git 命令行直接报错，但 SwiftPM/xcodebuild 内部的依赖解析在放弃之前会重试一段时间，把这条网络故障伪装成了"没反应"。

## 解法

把依赖 vendor 成本地路径依赖，让包解析彻底离线，不再连 github.com。`scripts/ios-swiftcheck.sh` 的做法：swift-rs 从 Xcode 的 DerivedData（或已有的 SwiftPM checkout 目录）里把已经解析过的一份拷出来、剥掉 `.git`，放进本地目录，再把生成的 `Package.swift` 里 `url:` 依赖改写成 `path:` 指向这份本地拷贝。代码本身也不走 `git clone`：Linux 侧用 `git bundle` 打出差量、`scp` 过去，Mac 侧从 bundle 里 fetch。

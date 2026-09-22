# 381 一次源码同步会把整个 iOS 构建重启，并留下一个连不上 dev server 的 app

## 现象

Mac 上两个 session 各自跑 `tauri ios dev`，第二个把自己那份 checkout 的 vite
端口改成 1421（1420 被第一个占着）。改完代码在 Linux 上 commit，Mac 上照常
`git fetch && git reset --hard FETCH_HEAD` 同步——本来只想让 vite 热更新一下。

结果是：xcodebuild 从头重跑一遍，模拟器里的 app 被重装重启，而 vite 没了。
app 上是一屏 Apple 自己的错误文案：

```
Failed to request http://localhost:1421/: error sending request for url
(http://localhost:1421/), did you grant local network permissions? That is
required to reach the development server.
```

这句话把人往"模拟器的本地网络权限"上带，实际和权限毫无关系。

## 原因

两件事叠在一起：

- `tauri ios dev` 盯着 `src-tauri/tauri.conf.json`。`reset --hard` 把那个文件
  重写回仓库里的版本（devUrl 又变回 1420），tauri 认为配置变了，于是把整条
  构建流水线重启。
- 重启会重新执行 `beforeDevCommand`，也就是 `bun run dev`。这一瞬间
  `vite.config.ts` 也已经被 reset 回 1420，而 1420 被另一个 session 占着，
  `strictPort: true` 让 vite 直接退出。随后我的 sed 把端口改回 1421，但 vite
  已经死了，没人再拉它起来。

app 于是指着一个没人监听的端口，缓存住那一屏错误页；`ios-sim.sh eval` 也随之
"the page never answered"。

## 解法

同步只动 app 真正要服务的源码，不碰构建配置：

```bash
git fetch -q linux <branch>
git checkout -q FETCH_HEAD -- src tests
```

`vite.config.ts` 和 `tauri.conf.json` 留在本地改过的状态，vite 只做一次 HMR。

如果已经踩了：单独 `bun run dev` 把 vite 拉回 1421，然后
`simctl terminate` + `simctl launch` 重启 app——reload 不够，错误页是原生那层
返回的。

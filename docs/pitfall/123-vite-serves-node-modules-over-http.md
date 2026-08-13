# vite 把 node_modules 也照样发给浏览器

## 现象

sim bridge 的一次性 token 写在 `node_modules/.sim-bridge/token`，理由是"per-checkout、已经在 .gitignore 里、vite 跑着的时候一定存在"。开着 dev server 直接请求：

```
$ curl -i http://localhost:1420/node_modules/.sim-bridge/token
HTTP/1.1 200 OK
Content-Type: text/javascript

1fb0835bc27a94f7287881e40d9578544b26ab0a8760ffa14db84e424224895a

//# sourceMappingURL=data:application/json;base64,...
```

200，token 在 body 里，还被当成 JS 模块加了一段把明文再抄一遍的 sourcemap。任何能往 dev server 发请求的东西都能把它读走。

## 原因

`server.fs.allow` 默认就是项目根（workspace root），`node_modules` 在根下面，所以它和 `src/` 一样是可服务的静态资源——依赖本来就是这么发给浏览器的。`.gitignore` 只管 git，和 HTTP 无关；文件权限 0600 也只管别的用户，dev server 是本人跑的，读得到。

## 解法

秘密写在 vite 服务的树之外：`~/Library/Caches/sim-bridge/<root 路径的 sha256 前 16 位>/token`（Linux 走 `XDG_CACHE_HOME`），一个 checkout 一个目录。`scripts/sim-bridge.ts` 的 `defaultTokenPath()` 和 `scripts/ios-sim.sh` 的 `bridge_token_file()` 各算一遍同一个路径。

另外两道：启动时把老版本留在 `node_modules/.sim-bridge` 的文件删掉；`server.fs.deny` 加上 `**/.sim-bridge/**` 和 `**/sim-bridge/*/token`（在 `configResolved` 里往已解析的数组 push，不能从 `config()` 返回，见坑 124），这样就算谁把 `fs.allow` 放宽到家目录，`/@fs/...` 那条路也是 403。deny 的匹配是 `nocase: true`，macOS 的大小写不敏感文件系统绕不过去。

顺带一个事实：vite dev 对根下面不存在的路径回的是 index.html（SPA fallback，200），不是 404。所以"文件已经不在那里了"这件事看到的是一份 HTML，不是 404。

# 给 server.fs.deny 一个数组，等于把 vite 的默认值删了

## 现象

坑 123 的收尾里给 sim bridge 插件加了一个 `config()` 钩子，把 token 的两个路径加进 `server.fs.deny`：

```ts
config() {
  return { server: { fs: { deny: ["**/.sim-bridge/**", "**/sim-bridge/*/token"] } } };
}
```

两个只差这个插件的空 vite 项目，同一个 `.env`：

```
$ curl -i http://127.0.0.1:5302/.env        # 没插件
HTTP/1.1 403 Forbidden
<h1>403 Restricted</h1>

$ curl -i http://127.0.0.1:5301/.env        # 有插件
HTTP/1.1 200 OK
Content-Type: text/javascript

GOOGLE_CLIENT_SECRET=super-secret-value

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi5lbnYiXSwic291cmNlc0NvbnRlbnQiOlsiR09PR0xFX0NMSUVOVF9TRUNSRVQ9c3VwZXItc2VjcmV0LXZhbHVlXG4iXX0=
```

`.env.local`、`server.crt`、`server.pem` 一样，全部 200。堵一个读得到但用不了的 token（`/eval` 拒收任何带浏览器头的请求），换来项目里每一个秘密都能按 HTTP 取走，还附赠一份明文 sourcemap。

## 原因

`node_modules/vite/dist/node/chunks/dep-*.js`，`resolveServerOptions()` 里一行：

```js
const deny = server.fs?.deny || [".env", ".env.*", "*.{crt,pem}"];
```

`||` 不是 merge。那三条默认值只在"没人提供 deny"时存在，任何人提供了就整份换掉。插件从 `config()` 返回的东西会先被 `mergeConfig` 并进用户配置——数组是拼接，所以插件和用户各自写的能共存——但拼完的结果照样走这一行，把默认值顶掉。合并发生在插件之间，不发生在插件和默认值之间。

vite 5.4.21 如此。同一份文件里 `_fsDenyGlob` 是在 `createServer` 里按 `config.server.fs.deny` 编译的，编译时机在 `configResolved` 之后。

## 解法

不走 `config()`，走 `configResolved()`，往已经解析好的数组上 push：

```ts
configResolved(config) {
  config.server.fs.deny.push(...DENY);
  ...
}
```

到 `configResolved` 那一刻数组里已经是 vite 定下来的内容——没人配就是那三条默认值，checkout 自己配了就是它配的——追加就是真的追加，两种情况都不丢。`config()` 做不到这件事：那个钩子看不见默认值，返回什么都是在替换。

判据推广一点：vite 配置里凡是用 `x || 默认值` 解析的字段，都是「提供即替换」，要加东西只能在 `configResolved` 上改已解析的值。

## 验的方法

单测断言配置对象没用——出事的正是"配置对象看着对，vite 拿它干了别的"。要起两个只差这个插件的 dev server 真发请求。`tests/sim-bridge-fs-deny.test.ts` 里的护栏是第二道：盯住 `config()` 不返回 deny，和 `configResolved` 之后三条默认值还在。

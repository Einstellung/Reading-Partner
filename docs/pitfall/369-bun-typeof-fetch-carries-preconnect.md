# 369 `typeof fetch` 在 bun 下带一个 `preconnect`

## 现象

给要发请求的模块开一个注入口 `fetchFn: typeof fetch = fetch`，测试里写假实现：

```ts
const fake: typeof fetch = async () => new Response("{}");
```

`bun test` 全绿，`bun run typecheck` 里 `tsc -p tsconfig.test.json` 报：

```
Property 'preconnect' is missing in type '() => Promise<Response>' but required in type 'typeof fetch'
```

## 原因

`@types/bun` 把全局 `fetch` 声明成一个带静态属性的函数（`fetch.preconnect(url)`，预热 DNS 和 TCP）。`typeof fetch` 于是不是「一个函数签名」而是「这个函数加它的属性」，任何手写的假实现都少这个属性。运行时没有人碰它，所以测试照跑。

## 解法

别用 `typeof fetch` 当注入口的类型，自己声明只包含这次真正要用的那部分：

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
```

真的 `fetch` 仍然能当默认值赋进去（多出来的属性不碍事），假实现也不用再补一个谁都不调的方法。

# 给 zip 定死一个时间戳，跨时区仍然不是同一份字节

## 现象

`buildArticleEpub` 要求同一篇文章构建出来字节完全一致（`importBook` 按内容哈希判重，不一致就是书架上两本同一篇）。zip 条目的时间戳是唯一的非确定来源，于是给 fflate 的 `zipSync` 传一个定死的瞬间：`Date.UTC(2001, 0, 1, 12, 0, 0)`。

同一台机器上反复构建确实一致，换时区就不一致了。local file header 第 11 个字节（DOS 时间的低位）三个时区三个值：

```
TZ=UTC                 ... 0,96,33,42,134,166,...
TZ=Asia/Tokyo          ... 0,168,33,42,134,166,...
TZ=America/Los_Angeles ... 0,32,33,42,134,166,...
```

## 原因

zip 存的是 DOS 日期时间，没有时区概念。fflate 用本地时间的取值器把 `mtime` 拆成字段（`fflate/esm/browser.js` 的 `wzh`）：

```js
var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
wbytes(d, b, (y << 25) | ((dt.getMonth() + 1) << 21) | (dt.getDate() << 16)
             | (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1));
```

`getHours()` 是本地小时。一个定死的 UTC 瞬间在东京是 21 点、在洛杉矶是 4 点，写进去就是三种字节。

顺带两条：`mtime: 0` 不能用，1970 年在 DOS 日期里表示不出来，fflate 直接 `err(10)`；`mtime` 传 `Date`、字符串还是毫秒数都一样，都要过 `new Date(...)` 再取本地字段。

## 解法

时间戳用本地日历字段构造，不用瞬间：

```ts
const FIXED_MTIME = new Date(2001, 0, 1, 12, 0, 0).getTime();
```

`new Date(y, m, d, h, ...)` 按本地时区解释这些字段，fflate 再用本地取值器读回来，拿到的就是写进去的那六个数，和机器在哪个时区无关。挑正午是为了避开午夜附近的夏令时跳变。

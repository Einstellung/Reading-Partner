# httpOnly 的反爬 cookie 比 `finished` 早几十秒进 jar，而且盘上看得见

## 现象

预热（先加载站点首页把 cookie 灌进 jar）在 `finished` 之后又睡 15 秒。注释给的理由是"bot 检测 cookie 是 httpOnly，注入的脚本看不见，所以没东西可 poll，只能按秒等"。

## 原因

看不见的是**注入的 JS**，不是没法看见。WebKitGTK 边跑边把 jar 写到 `<profile>/cookies`，Netscape 文本格式，httpOnly 的行也在里面（域名字段带 `#HttpOnly_` 前缀，见坑 110）。

实测（2026-08-12，每 200ms 读一次这个文件）：冷 profile 打开 `https://www.bloomberg.com/`，`_pxhd` 在 +1.0s 落盘，PerimeterX 真正那几条 `_px3` / `_px2` / `_pxvid` / `_pxde` 在 +6.5s 落盘，全部 cookie 在 +9.4s 之前到齐。而同一次加载 `finished` 60 秒都没来，整个 fetch 因为等不到那个事件失败了。要等的东西比在等的事件早了四十多秒。

首页本身也测了：DOM 在 `finished` 之后 6ms 就是全的，45.4 秒里没变过。

## 解法

预热不按秒睡了，改成和取正文同一条判据：页面不再变化、且不是拦截页（实测 3 秒退出）。

再往前一步是把预热的完成判据换成 jar 而不是 `finished`：首页是全站最重的页，实测 `finished` 只来过一次（43 秒），之后八次都是 60 秒超时，每次都让整个 fetch 失败——而失败那次的 jar 里躺着 47 条 cookie，`_px3` 在内。预热要的东西拿到了，只是没人认。

这一步还没做：jar 的落盘时机不归调用方管（坑 111），拿它当判据得先单独实测。

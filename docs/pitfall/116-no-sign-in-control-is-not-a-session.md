# 页面上没有登录入口不等于已登录

## 现象

登录窗口里想实时看出"用户登录成功了"，手边现成的信号是 `seesSignIn`（页面上还有没有写着 sign in / log in 的可点元素），取正文那条路就是拿它判会话真假的。放到登录窗口里，它两头都不成立。

实测 2026-08-12，冷 profile，`RP_WEBVIEW_SESSION_PROBE=signin:...` 跑在 Xvfb 里，每 3 秒一次：

- 彭博登录页 `/account/signin`：`seesSignIn` 从头到尾是 false。页面上可点的东西写的是 Continue、Continue with Google、Continue with Apple、Continue with BBA、Create one、Need help?，"Sign in"是个标题不是控件。也就是说用户正在输密码的那一页，按这个信号读出来是"已登录"。
- 彭博首页（未登录）：`seesSignIn` 到第 2 次 poll（约 6 秒）才变 true，此前页面已经有 12077 个字符。字符数 12077 → 13468 → 17081 → 17084 → 17085 涨到约 18 秒才停，之后 60 秒一个字符不动。
- 同一个首页，`document.readyState` 到第 7 次 poll（约 21 秒）才 complete。拿 readyState 当"页面画完了"，等于白等 20 秒；别的站点上它可能永远不来。

## 原因

站点的头部（挂着登录入口的那块）是后渲染的，比正文晚好几秒。而登录页是一张表单，它本来就没有"去登录"的入口——那正是它自己。所以"没看见登录入口"这句话，在一张还在长的页面上、在登录页上，都不代表任何事。

## 解法

只在页面自己承认画完了的时候读它，并且把登录页排除掉：

- 同站才算（`login.bloomberg.com` 算，`accounts.google.com` 不算）。
- 路径以登录页的路径开头的不算，用户还在那儿干活。
- 字符数低于 2000 的不算：登录页 535，首页 17085，尺寸本身就分得开表单和站点页面。
- 字符数和上一次 poll 相同才算数，连续两次这样的 poll 才改窗口标题。停止增长是"画完了"的判据，比 readyState 早十几秒，且不依赖它会不会来。

判据和单测在 `src-tauri/src/webview_fetch/session.rs` 的 `SignInWatch`，页面那侧只报数不判断（`sign-in.js`）。三条都不成立时什么也不做：标题保持原样，不报错，流程仍旧以用户关窗为准。

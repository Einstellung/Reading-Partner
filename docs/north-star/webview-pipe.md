# Webview 渲染管子

## 愿景

信息源普适性的下一跳。SSR 站点现有管子已覆盖；webview 管子解锁两类现在接不了的源：纯 SPA 站（无 SSR），和登录墙站（经济学人、Science 这类用户自己有会员的）。

载体是隐藏的 Tauri WebviewWindow 当渲染引擎。不引 Playwright、不捆 Chromium（体积、iOS 禁运、调研已否）。页面加载后注入脚本，等渲染稳定（DOMContentLoaded 加静默，或 descriptor 声明 waitFor 选择器），DOM 序列化经 IPC 交回现有 Readability 抽取栈。真实 cookie 加真实 UA，比 headless 更不像机器人。

descriptor 只扩两个口：discovery 的 `webview-listpage`、fulltext 的 `webview-page`，其余体系不动。AI 著作权覆盖到这里——判断 SSR 抓不动就声明 webview 型，trial 照样当闸。

登录墙：首次订阅弹一个可见 webview 窗口，用户自己登录（自己账号，红线内），登录态存 webview cookie；之后隐藏渲染复用会话。会话过期表现为源健康态变黄，点击重新弹窗登录。反爬硬墙（PerimeterX 类）不对抗，如实标不可用。

懒全文：发现层照常走 feed（免渲染），全文渲染推迟到 triage 选进 mustRead 或用户点开那一刻。一天渲染两三页，而不是二十页。

## 为什么现在不做

0.6.0 发版后再 spike。descriptor 体系（[17](../17-信息源系统.md)）先立住，webview 是它的扩展口，不是另起炉灶。

## 将来做时已知的事实

待 spike 的三个未知数，都要真机验证，结论进 `docs/pitfall/`：

- WebKitGTK 隐藏窗口是否正常渲染并跑 JS。
- cookie 跨 app 重启的持久性（Linux 和 macOS 可能不同）。
- 隐藏 webview 与主窗口的资源竞争（预计串行化，一次一个）。

节奏：0.6.0 发版后 spike；第一根管子用项目发起人的经济学人会员端到端验证；M-info-3 头牌。

# 账户

## 定案（2026-10-17）

设置里新增「Accounts」页（英文界面名 Accounts），是 app 里唯一的登录入口。它列出 app 能用的每个账户，一行一个：状态（已登录 / 已失效 / 未登录，另有"未检查""判断不了"）、这个账户带来什么，以及检查、登录、退出按钮。不是用户画像页，不放画像内容。

原先信息源页上的站点登录（X、Bloomberg）搬到这里，信息源页整页从界面上去掉。简报本身不动，以后重设计；源插件、源健康记录、调度照常运行，只是不再显示给用户。

设置原来的第一个 tab「Account」放的是 AI 供应商登录、模型和同步，改名「AI & sync」，免得和「Accounts」并排时分不清。AI 供应商和 Google 同步留在那里，不进 Accounts。

## 做法

账户注册表在 `src/info/sources/accounts.ts`。现在两项，都是浏览器会话：X（登录页 `x.com/i/flow/login`，主题搜索用）和 Bloomberg（登录页 `bloomberg.com/account/signin`，简报拿全文用）。注册表里的账户不管订没订都有一行。用户在对话里加的源如果自带登录页，也各占一行，排在注册表之后，第二行写"被哪些源使用"。

登录流程沿用原有机制：`site-session.ts` 决定检查结果的含义，`session-flow.ts` 管检查、登录、退出的先后，`workshop/extract/webview-session.ts` 管窗口和 cookie。页面是 `ui/components/settings/AccountsPanel.tsx`，状态和动作在同目录的 `use-accounts.ts`，每行说什么由 `accountView()` 算，有单测。

"已失效"的判法：一次确定的检查发现没登录，而上一次记录是登录着（或已经是失效），就记 `expired`。用户自己点退出会清掉这个站点的记录，所以不会被算成失效。X 停手记 `signed-out` 时写的也是同一份记录，会让 X 行显示已失效。

能登录的只有采集端且有 webview 的桌面（Linux、macOS）。阅读端（手机、平板、不采集的电脑）的行只读，显示采集端状态文件里的 `sites`：在哪台机器上已登录或需要登录；还没有采集端报到时写"在采集信息源的电脑上登录"。采集端状态文件的 `sites` 现在按注册表加订阅源算，所以 X、Bloomberg 总在里面。

对话里的 `sign_in_to_site` 工具从同一份账户列表里挑站点，失败时让用户去 Settings › Accounts。

## 以后加账户

再加一个浏览器会话类网站（Instagram、Facebook、微博）是在 `ACCOUNTS` 里加一项：名字、登录页、一句好处（文案进 `i18n/messages/sources`）。

API 凭据类（GitHub 令牌、Semantic Scholar key）是新的 `kind`，要在 `session-flow.ts` 旁边写它自己的流程，页面按 kind 分发按钮。GitHub 未认证每小时 60 次，认证后 5000 次，网页 cookie 不起作用，要令牌。做法倾向 OAuth 设备流：app 显示一个码，用户在浏览器授权，令牌存本机不出本机，不让用户复制粘贴令牌。这些现在都不做。

## 不变的规矩

- 登录规矩沿用 [57](../info/57-登录态浏览器取材与computer-use.md)：登录由用户自己完成，cookie 不出本机，会话失效不自动重登，等用户处理。
- 登录页只来自代码里的注册表和用户订阅源的描述，模型给的 URL 不能变成登录页（`site-session.ts` 里 `resolveSignInSite` 的注释）。
- 登录失效提示落在采集端状态文件的 `sites` 字段（见 [36](../info/36-采集端与阅读端.md)）。

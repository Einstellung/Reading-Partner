# local run 不走选举，`requires` 管不着它派给谁

## 现象

手机上应用一周三餐（v0.21.1），电脑上什么都没发生：没有 `info-meals-photos.json`、没有 `meals-photos` 的 run 记录、界面上每道菜都只有配料拼图。手机自己也不报错。

## 原因

`meals-photos` 注册的是 `tier: "local"` + `requires: [WEBVIEW_FETCH]`，注释写的是「哪台机器跑由 webview-fetch 这个标签的选举决定」——反了。

`requires` 只在同步 run 的选举里起作用（`legion/claim/elect.ts`）。`local` run 根本不进那条路：`runner.ts` 的 `delegate` 看到 `tier === "local"` 就地转 `running`，在派发它的那台机器上当场执行。手机派了，手机就自己跑；手机没有隐藏 webview，`fetchPageViaWebview` 返回 `unsupported`，worker 第一条查询就抛，一张图都不搜，电脑那边从头到尾不知道有人要过图。

## 解法

能搜的机器自己发起，不等别人派：声明了 `WEBVIEW_FETCH` 的设备读同步过来的 `info-meals.json` 和 `info-meals-photos.json`，自己算出这周还缺什么再起 run（`src/info/meals/photos/photo-sweep.ts`）。启动、pull 写了这两份文件、本机应用周计划，三个时机同一趟，一次只跑一个。

没有这个能力的设备一条都不起：`startPhotoRun` 这个 port 在那些机器上就不挂，worker 自己在读 ask 之前也再拒一次——图片缓存是同步的，手机跑一趟就是把整周写成 miss，在电脑上压三十天。

用户说图不对这种反向请求当数据走：在 `info-meals.json` 上写 `photosAskedAt`，比它旧的缓存条目算过期。

`local` + `requires` 这个组合本身没错，只是 `requires` 在这里是「哪台机器允许起这个 run」的说明，不是分派规则。

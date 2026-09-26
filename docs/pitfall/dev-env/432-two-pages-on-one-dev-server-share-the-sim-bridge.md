# 432 两个页面连着同一个 dev server，sim bridge 的 eval 落到谁手里不确定

## 现象

同一个 vite（1440）上，模拟器 B 的 Safari 开着探针页，模拟器 A 的 app 刚起来连上。`ios-sim.sh eval` 指的是 Safari 里的探针，回来的却是 `page threw: ... loop@tauri://localhost:33:74`，一整轮测量全打在 app 的首页上。`IOS_SIM_UDID` 换成 B 也没用。

## 原因

sim bridge 按端口寻址，不按设备。凡是这个 dev server 发出去的 HTML 都注入了轮询客户端（`scripts/sim-bridge.ts`），每个页面都在长轮询同一个 `/__sim/poll`，命令交给先来取的那个。`IOS_SIM_UDID` 只管 idb 的触摸和截图，管不到 eval。

## 解法

一个 dev server 同一时刻只留一个页面在轮询：换页面前先 `simctl terminate <udid> com.apple.mobilesafari`，或者给 Safari 那份另起一个端口的 vite。eval 的返回里带上 `location.href` 或页面自己的标记（探针用 `location.search.includes(tok)`）再读数，没对上就作废这轮。

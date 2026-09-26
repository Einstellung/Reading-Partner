# 同步的后三档

## 愿景

同步今天停在档 1：整棵树对拉，不推断删除。[59](../platform/59-同步：持有清单与裁决.md) 定了往上三档——档 2 按持有清单推断删除，档 3 线程按消息合并，档 4 冲突交给一个 agent 裁决。档 4 已做（59 §6「落地」），剩档 2 和档 3。

## 为什么现在不做

档 2 翻开前要先补 `retired` 的生产端，翻早了会把路径读成删除。档 3 是一轮活，没有用户在催。

## 将来做时已知的事实

- 档 2 的算法和引擎接线全在：`src/platform/sync/infer-deletions.ts`，开关是同一个文件里的 `HOLDINGS_INFER_DELETIONS = false`。
- 翻开前必须补 `selfHoldings` 的 `retired` 生产端：`src/platform/sync/holdings.ts` 有字段，没人填；范围一收窄，对端会把那些路径读成删除。
- holdings 的 `app` 字段已经带上（8e1e7351），报告里看得到对端版本。
- 档 3：`src/palace/kinds.ts` 里四种 threads 行都用 `MAP_THREADS`，合并停在 records 级。59 §5 的 `messages` 策略、消息身份、前缀取长、journal 都没有。
- 59 §4 说的迁移闸门改成自己设备的树差分没做。
- [13](../platform/13-账户同步.md) 的「按需与分批」整节没做：按需下载只在手机 EPUB 上有（`src/reading/engine`、`src/ui/components/phone/PhoneShelf.tsx`），桌面和 iPad 的书仍然全量镜像，书架没有「在云端」这个状态。
- 开发者用的 sync doctor 屏没有，今天只有控制台里的 `window.__syncHoldings()`（`src/platform/sync/index.ts`）。
- [18](../platform/18-iOS-Google登录.md) 的 iOS 登录冷启动续跑没做，PKCE 的 verifier 和 state 只在内存（`src/platform/sync/auth.ts`）。

## 待定

59 §10 剩两条：退出再登录留下的孤儿文件；三台以上设备的三方状态。「不可推断删除名单谁维护」和「裁决用哪个模型」已做掉，裁决的额度等真实冲突的量出来再定。

[50](../platform/50-删除.md) 留了两条没做：删除日志压缩和过期（判据是「比最老设备的 lastSyncAt 还老」，需要各设备心跳文件，今天没有）；给读者一个「这本书留下的印象一起删」的选项，把只以这本书为证据的 statement 一并标掉（statement 默认不随书删，这是要不要开一个显式第二档）。

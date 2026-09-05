# 217 国行 iPhone 上新装的 app 联网前要人点一下，没点的请求 1 毫秒就失败

## 现象

真机 live 腿，12 句 TTS 全部失败，12 条错误一字不差：

```
the voice service could not be reached: error sending request for url (https://api.xiaomimimo.com/v1/chat/completions)
```

时间上不像网络问题：第一句 0.81 ms 发出、15.02 ms 失败，后面每句在开跑后 2.5–4.0 ms 内把三次重试跑完，
每次尝试约 1 ms 就回来。不是超时，是立刻拒绝。

这个错误串里没有任何线索。同一时刻 Mac 上 `curl` 同一个域名回 401（也就是服务是通的），
手机的 WiFi 好好的，Safari 打得开网页，key 也没问题（key 错会以 401 的 `Status` 错误回来，不是 transport）。

## 原因

国行 iPhone 的「无线数据」（设置 → 无线数据）对每个 app 单独授权，新装的 app 默认没有。
在授权之前，这个 app 的出站请求在系统层就被拒绝，连接从来没有离开手机。

reqwest 那边看到的只是一个立刻返回的连接错误，而当时 `transport()` 只留 `to_string()`、把 source chain 丢了，
于是记录里 DNS、connect、TLS、系统拒绝四种情况长得一模一样。

云签名的 `.dev` 包每一轮都是重新安装的，所以这个授权每次重装都要重点一次。

## 解法

装机之后、跑任何要联网的腿之前，先在手机上 设置 → 无线数据 里给这个 app 打开。
装机步骤里加了这一条（`scripts/ios-dictation/README.md`）。

判据：请求在 1–2 ms 内以传输错误失败，而同一时刻别的机器够得到那个服务，先怀疑授权，别怀疑网络。
真的 DNS 或 TLS 问题不会这么快。

错误本身说不清自己那一半已经修了：`describe_chain`（`plugins/voice/src/tts/error.rs`）把整条 source chain
拼进 message，下一次同样的现象至少分得出 DNS、connect 和 TLS。

# fake-ip 下的 DNS 结果说明不了这个域名走没走代理

## 现象

同一台机器上量三家 TTS 的首包延迟，小米 `api.xiaomimimo.com` 稳定 1.1–1.9 秒，硅基流动和阿里只要 210–365ms，慢 4–6 倍。分段看 TLS 握手：小米 882ms，另两家 93ms / 82ms。差距一度被写成「小米服务端慢」。

## 误判的根源

用 `getent hosts` 查，三个域名全部解析到 `198.18.0.x`，于是判断「三家都进了隧道，条件相同，可以横向比」。

本机跑的是 mihomo TUN + fake-ip（`fake-ip-range: 198.18.0.1/16`）。fake-ip 模式下 DNS 永远返回一个占位 IP，和这个域名最终走代理还是直连没有任何关系：真正的分流发生在连接建立时，mihomo 从 fake-ip 反查回真实域名再按规则匹配。所以 DNS 结果不能用来判断分流。`dig +short @223.5.5.5` 也拿不到真实 IP，配置里 `dns-hijack: any:53` 把所有 53 端口查询都劫持了。

## 原因

规则链末尾是 `GEOSITE,CN,DIRECT` 然后 `MATCH,<代理组>`。硅基流动和阿里命中 GEOSITE CN 走直连，`api.xiaomimimo.com` 没命中，落到兜底走了代理绕一圈。没命中是因为 `geosite.dat` 的日期是 2025-11-19，而小米 MiMo 开放平台 2026 年才上线，这个域名不在那份 CN 列表里。任何 2026 年新上线的国内服务都可能一样。

## 怎么确诊

mihomo 内核的 API 直接给出每条连接匹配了哪条规则、走了哪条链。本机 mihomo-party 用 unix socket：

```
ps -ef | grep sidecar/mihomo          # -ext-ctl-unix 参数就是 socket 路径
curl -s --unix-socket <sock> http://localhost/version
# 发一个到目标域名的请求，然后立刻：
curl -s --unix-socket <sock> http://localhost/connections
```

在返回的 JSON 里找 `metadata.host` 匹配的那条，看 `rule` 和 `chains`。实测是 `rule=Match`、`chains=['spring-1-static-ip', '静态IP']`，走的就是代理。命中直连的话 `rule` 是 `GeoSite` 之类，`chains` 是 `['DIRECT']`。

## 解法

在规则最前面加 `DOMAIN-SUFFIX,<域名>,DIRECT`。两处都要改：`~/.config/mihomo-party/profiles/<id>.yaml`（源，持久）和 `~/.config/mihomo-party/work/config.yaml`（运行时）。两个文件的 YAML 缩进风格不同（profile 里 `rules:` 下顶格，work 里两空格），改之前先备份。改完从同一个 socket 热重载，不用重启客户端：

```
curl -s -X PUT --unix-socket <sock> "http://localhost/configs?force=true" \
  -H "Content-Type: application/json" -d '{"path":"<work/config.yaml 的绝对路径>"}'
```

返回 204 即成功。

效果：TLS 握手约 900ms → 78ms，请求到首帧 PCM 1353ms → 665ms，端到端首字 2247ms → 736ms。

## 要记住的判断

走代理时「请求→首帧」这一段同样包含数据经代理往返的时间，不只是服务端处理时间。所以「去掉建连开销后剩下的差距就是服务端的账」是错的——去掉隧道之后小米的服务端那一段也快了一倍。跨供应商比延迟之前，先确认每一家走的是同一种路径。

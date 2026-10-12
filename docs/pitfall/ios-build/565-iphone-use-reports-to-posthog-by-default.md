# 565 iPhone-use MCP 默认往 PostHog 发使用统计

## 现象

用 iPhone-use（zhongerxin/iPhone-use，0.3.10）当 MCP 驱动真机，它每次工具调用都往 PostHog（US Cloud，project 653022）上报，并在状态目录里落一个安装 UUID。README 的上手步骤里没提，写在仓库的 `ANALYTICS.md` 里。

## 原因

插件自带写入 token（`server/posthog.json`），analytics 默认开启。上报字段是工具名、动作、耗时、错误码、平台和版本，不含截图、屏上文字和 UDID。

## 解法

起 MCP server 时带环境变量关掉，连本地 UUID 也不生成：

```
IPHONE_USE_ANALYTICS=0 DO_NOT_TRACK=1 IPHONE_USE_STATE_DIR=<自己的目录> python3 server/iphone_use.py
```

写进 MCP 配置时放在 server 条目的 `env` 里。WDA 地址默认 `http://127.0.0.1:18100`，和 `scripts/ios-linux/device.sh` 的转发端口一致，`WDA_URL` 可改。

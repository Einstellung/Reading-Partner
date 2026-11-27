# http scope 的 `https://*` 不放行带端口的 URL

现象：设置页自定义 OpenAI 兼容接口填 `https://127.0.0.1:1/v1`，「Test and save」报 `url not allowed on the configured scope: https://127.0.0.1:1/v1/chat/completions`，`/models` 也静默失败。`default.json` 的 `http:default` 里明明有 `{ "url": "https://*" }`。2026-11-26 在 Linux debug 包上实测。

原因：当前 http 插件的 scope 匹配把端口当成单独一段，`https://*` 只覆盖默认端口。坑 28 说的「整串 glob、`*` 吃掉 host+path」对不带端口的 URL 成立，对显式端口不成立。

解法：allow 列表再加一条 `{ "url": "https://*:*" }`，加上后同一个请求走到了网络层（报 Connection refused）。自托管的 OpenAI 兼容服务常带端口，不加这条，自定义接口填带端口的地址就发不出请求。

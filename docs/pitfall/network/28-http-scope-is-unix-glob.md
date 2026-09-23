# Tauri http scope 是 UNIX glob，不是 URLPattern

现象：给 `http:default` 的 allow 列表放宽到"任意 https 主机"（贴链接功能，docs/09）时，凭直觉写 `https://*/*` 想匹配"任意主机任意路径"。

原因：Tauri v2 的 http/opener scope 用 `glob::Pattern`（UNIX glob）匹配整个 URL 字符串，不是 Web 的 URLPattern。glob 里 `*` 默认能跨 `/`（`require_literal_separator` 默认 false），所以：

- `https://*` = 所有 https URL（官方示例原话 "allows all HTTPS origin"），`*` 把 host+path+query 一整段都吃掉。
- 现有的 `https://arxiv.org/*` 能匹配 `https://arxiv.org/pdf/2303.12345`，靠的就是 `*` 跨 `/`。
- `https://*/*` 反而别扭：按 glob 逐字符匹配、无 per-segment 锚定，语义不清晰，别用。

解法：要"任意 https 主机"就写单条 `{ "url": "https://*" }`。子域名用 `https://*.example.com/...`，前缀用 `https://host/path/*`。

关联：scope 匹配代码见 plugins-workspace 的 `is_url_allowed`/`matches_url`（`glob::Pattern::matches`）。

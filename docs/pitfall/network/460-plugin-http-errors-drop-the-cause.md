# http 插件的网络错误只剩 "error sending request for url (…)"

现象：请求没拿到响应时，JS 侧拿到的整句是 `error sending request for url (<完整 URL>)`，看不出是 DNS、连接被拒、超时还是 TLS；URL 带长 query 时，一行显示的状态栏连这句也截断在 query 里。

原因：tauri-plugin-http 的 `Error` 序列化成 `self.to_string()`（2.5.9 和 2.7.0 都是），`Network(reqwest::Error)` 是 `#[error(transparent)]`，而 reqwest 的 `Display` 只写种类加 URL，真正的原因（`client error (Connect): tcp connect error: …`、`dns error: …`）只在 `source()` 链里，没人拼进去。

解法：`src-tauri/vendor/tauri-plugin-http` 是插件 2.5.9 的原样拷贝，经 `Cargo.toml` 的 `[patch.crates-io]` 生效，只改了 `src/error.rs` 的 `describe()`：顺着 `source()` 链全部拼上，并把 URL 的 query 换成 `?…`。现在同一个失败读作 `error sending request for url (http://127.0.0.1:1/drive/v3/files?…): client error (Connect): tcp connect error: Connection refused (os error 111)`。升插件版本时要重新拷一份再补这处，否则 patch 不生效或退回旧行为。

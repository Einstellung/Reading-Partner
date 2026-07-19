# 语音 STT 请求走插件、录音字节走 IPC 数字数组

现象：给语音输入接 STT 时，两处会咬人。

1. 直接 `fetch("https://api.siliconflow.cn/v1/audio/transcriptions", ...)` 在 webview 里必失败。`tauri.conf.json` 的 CSP `connect-src` 是 `'self' ipc: http://ipc.localhost`——任何跨源直连被拦；就算放开 CSP，STT 主机也不发 CORS 头。而 `src/ai/fetch-bridge.ts` 的 window.fetch 桥只桥接固定几个 AI 主机（不含 STT 供应商），所以走的是原生 fetch，撞上面两堵墙。

2. Rust 命令 `stop_voice_recording -> Vec<u8>` 回到 JS 不是二进制，是 JSON 数字数组（`number[]`）。当作 ArrayBuffer 用会错。

原因：CSP + 无 CORS 是 webview 直连的固有限制；Tauri v2 默认用 serde 把 `Vec<u8>` 序列化成数字数组过 IPC。

解法：

1. STT 请求用 `cleanTauriFetch`（Tauri http 插件，走 IPC，绕开 CSP/CORS），不要用 window.fetch。任意 https 主机由 `capabilities/default.json` 的 `https://*` scope 放行。见 `src/voice/index.ts` 的 `sttFetch`。
2. JS 侧 `new Uint8Array(await invoke<number[]>("stop_voice_recording"))` 还原字节。见 `src/voice/recorder.ts`。长录音这条数字数组偏重，90s 上限兜底。

相关：cpal 的 `Stream` 不是 `Send`，不能塞进共享 state 从别的命令线程碰。用独立线程持有 stream、AtomicBool 通知停止、回调把采样推进 `Arc<Mutex<Vec<f32>>>`。见 `src-tauri/src/voice.rs`。

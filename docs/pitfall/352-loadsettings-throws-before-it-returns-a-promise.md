# loadSettings() 在返回 promise 之前就抛，`.catch()` 接不住

## 现象

想给 `researchWorker` 写一个用真 `liveAgent()` 的接线测试（不注入 `agent`，看它挂的是不是文献子 agent），跑起来当场：

```
ReferenceError: window is not defined
  at invoke (node_modules/@tauri-apps/api/core.js:202:12)
  at exists (node_modules/@tauri-apps/plugin-fs/dist-js/index.js:725:18)
  at readGuardedJson (src/platform/app/atomic-fs.ts:127:25)
  at load (src/platform/app/settings.ts:261:27)
  at liveAgent (src/reading/papers/research-worker.ts:27:26)
```

`liveAgent` 那一行写的是 `await loadSettings().catch(() => null)`，异常还是逃了出来。

## 原因

`loadSettings` 不是 `async`：

```ts
export const loadSettings = (): Promise<Settings> => store.load();
```

`store.load()` 里的 `readGuardedJson` 直接调 Tauri 的 `exists()`，宿主之外读 `window.__TAURI_INTERNALS__` 同步抛。抛在 `loadSettings` 返回 promise 之前，于是没有 promise 可以 `.catch()`，异常从调用点原样逃出去。签名写着 `Promise<Settings>`，看不出这件事。

## 解法

要在测试里跑真的 `loadSettings()`（或任何走 appData 的读），先在 `beforeEach` 里 `installAppData()`（`tests/support/appdata-fake.ts`）装一块内存盘，宿主那两个包被 spy 掉，同步抛就不会发生。不想装的话，把这个依赖当参数收，测试传假的进去。

调用点想真的兜住同步抛，`.catch()` 不够，得 `try` 包住整个调用。`loadSettings` 本身不用改——它只在宿主里跑。

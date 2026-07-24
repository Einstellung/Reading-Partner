# iOS 首装首跑第一个写入者报 os error 2（app 数据根目录没人建）

## 现象

iOS 全新安装后第一次运行，第一个往 AppData 写文件的动作直接失败：`failed to open file ... (os error 2)`（ENOENT）。踩到的是 Google 登录——它是首跑最早的写入者，`saveAuth` 写 `sync-auth.json` 时目录还不存在。

## 原因

Tauri 从 bundle identifier 推导出 app 的 per-app 数据目录，但从不创建它；`writeTextFile` 也不建父目录（更不会建根目录）。桌面上这个目录往往因别的原因早已存在，问题被掩盖；iOS 沙盒全新安装时它真的不存在，于是谁先写谁踩坑。

前端曾靠各写入模块自己兜底：约 13 个 store 各抄一份「根目录 `""` 不在就 `mkdir("")`」的 `ensureDir`。这是把一个全 app 的前置条件散在每个写入点上，漏一个就炸，且顺序上仍可能被某个没兜底的写入者抢先。

## 解法

把「数据根目录存在」提为启动时的元能力，收口到 Rust。`src-tauri/src/lib.rs` 的 `setup` 钩子里（`migrate_legacy_dirs` 之前）用 `app.path().app_data_dir()` 拿路径、`std::fs::create_dir_all` 创建。幂等，每次启动都跑；失败只记日志不 panic——真出问题会在实际写入处自然暴露。

前端随之删掉所有「只保障根目录」的 `ensureDir`（helper、调用点、多余 import）。注意甄别：创建**子目录**的 `mkdir`（`sync/books.ts` 的 `library/`、`syncFs.ts` 的父目录逻辑、`slides`、`prep`、`notes`、`app/library` 等）一律保留——那些不是根目录保障，Rust 的元能力也不覆盖它们。

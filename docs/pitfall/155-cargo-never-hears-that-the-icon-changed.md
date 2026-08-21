# 换了图标重跑 dev，窗口上还是旧的那个

## 现象

换掉 `src-tauri/icons/` 下的 PNG，`bun run tauri icon` 重新生成一整套，再 `bun run dev:capped`，窗口和任务栏还是旧图标。再改再跑还是一样，cargo 每次都说没什么要编译。

## 原因

图标是编译期嵌进二进制的，而 cargo 不知道图片变了。两层都没有记下这个依赖：

- `src-tauri/build.rs` 只调 `tauri_build::build()`。它发出的 `cargo:rerun-if-changed` 只有配置文件（`~/.cargo/registry/src/*/tauri-build-2.6.3/src/lib.rs:485`）、capabilities 目录（`acl.rs:427`）、externalBin 和 resources（`lib.rs:64`、`lib.rs:93`），移动端另加 gradle 文件和 Info.plist。图标那几行在 `codegen/context.rs:104`，只有 build.rs 显式建 `CodegenContext` 时才跑，这个项目没建。
- `tauri::generate_context!`（`src-tauri/src/lib.rs`）在宏展开时 `std::fs::read` 读图标、解成 RGBA、按内容的 blake3 校验和写进 `OUT_DIR`，展开出来的是 `include_bytes!(concat!(env!("OUT_DIR"), "/<校验和>"))`。所以连 rustc 自己的依赖记录里也没有 `src-tauri/icons/` 下的任何路径。

于是：图片变了 → cargo 认为这个 crate 的输入一个都没变 → 不重新编译 → 二进制里还是上次嵌进去的那份字节。任何增量构建都这样，不限于 dev。

窗口上真正显示的那份也不是想当然的那个文件：桌面取 `tauri.conf.json` 的 `bundle.icon` 里第一个 `.png`（这里是 `icons/32x32.png`，不是 `icon.png`），Windows 取第一个 `.ico`，macOS 的 dev 还另外读 `.icns` 当 app 图标。

## 解法

`touch src-tauri/tauri.conf.json` 再起 dev。配置文件在 rerun-if-changed 名单上，build script 重跑，crate 跟着重编，宏这才重新去读图标。

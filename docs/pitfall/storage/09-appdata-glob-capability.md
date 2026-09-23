# Tauri 权限 glob 不匹配目录本身

现象：M1 实战踩到。阅读位置从来没保存成功，但界面毫无异常——重开永远回到第一页。

原因：capability 里只授了 `$APPDATA/**`，而这个 glob 不匹配 `$APPDATA` 目录本身。保存前对 appdata 根目录的 `exists("")`/`mkdir("")` 被权限拒，整条保存链抛错，又被 `.catch(() => {})` 静默吞掉。

解法（两条都做）：

1. capability 里 `$APPDATA` 和 `$APPDATA/**` 都要授；
2. 持久化失败绝不静默吞——console.error + 界面警告，让这类问题第一时间暴露。

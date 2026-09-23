# 无签名 iOS 二进制过第三方重签名器后真机秒崩（__LINKEDIT vmsize 不更新）

## 现象

`tauri ios build --no-sign` 出的完全无签名 ipa，经免费签名器（Dadoum Sideloader 1.0-pre4、疑似 Sideloadly 同类）重签后装到真机，启动瞬间被 dyld 杀掉，日志：`segment '__LINKEDIT' filesize exceeds vmsize`。模拟器不复现（模拟器装的是未重签的原包）。

## 原因

完全无签名的 Mach-O 没有 `LC_CODE_SIGNATURE`。重签名器给它「从无到有」加签名时，把签名 blob 追加进 `__LINKEDIT` 段、只撑大了该段的 `filesize`，忘了同步撑大 `vmsize`。于是 `filesize > vmsize`，dyld 加载时判定段越界，直接 abort。

这是重签名器「add-from-scratch」路径的 bug；它们「替换已有签名」的路径成熟得多，会正确重排 `__LINKEDIT` 布局。

## 解法

CI 出包后、上传前，在 macOS runner 上对 .app 做 ad-hoc 签名，让二进制带上规范的 `LC_CODE_SIGNATURE` 和页对齐的 `__LINKEDIT`（`vmsize >= filesize`）：

```
codesign --force --sign - --deep "Payload/<App>.app"
```

之后重新打 ipa。重签名器面对「已有签名」走替换路径，布局正确，真机正常启动。ad-hoc 不需要任何证书或账号，也不需要 entitlement（深链接是 `CFBundleURLTypes` 自定义 scheme，不吃 entitlement）。

`.github/workflows/ios-sideload-ipa.yml` 的 verify 步断言二进制带 `LC_CODE_SIGNATURE`，并用 `.github/scripts/assert-linkedit-vmsize.py` 解析 Mach-O 断言 `__LINKEDIT` 的 `vmsize >= filesize`。

只有 sideload 线要这一步；simulator-smoke 线装的是未重签的原包，simctl 直接跑，不受影响。

手工验尸时用 `otool -l <bin>` 看 `__LINKEDIT` 的 vmsize/filesize，或 `codesign -dv <app>` 看是否有签名。

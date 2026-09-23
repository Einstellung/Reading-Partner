# zipalign 的 16 KB 对齐参数在 build-tools 34 上不存在，签名步骤直接退 2

## 现象

Android APK workflow 在「Sign the APK」这一步红掉，编译和打包都成功了，死在对齐上：

```
zipalign: invalid option -- 'P'
ERROR: unknown flag -?
Usage: zipalign [-f] [-p] [-v] [-z] <align> infile.zip outfile.zip
```

`-P 16` 是 Google 自己文档里写的 16 KB page size 对齐写法，看起来没有理由不认。

## 原因

`zipalign` 的 `-P <pagesize_kb>` 是 build-tools 35 才加的。34.0.0 那一版只有 `-p`（按固定 4 KB 页对齐未压缩的 `.so`），遇到 `-P` 就打 usage 退 2。Android 文档讲 16 KB 对齐时不标最低 build-tools 版本，所以钉死在 34.0.0 的 CI 看文档照抄必红。

## 解法

`.github/workflows/android-apk.yml` 的 `BUILD_TOOLS_VERSION` 用 `36.0.0`。ubuntu-24.04 镜像预装了它，不额外下载。

对齐不靠这一个参数保证。同一条 workflow 里另有一步从产物里 `unzip` 出 `lib/*/*.so`，用 `readelf -lW` 逐个断言每个 LOAD 段的对齐是 `0x4000` 或 `0x10000`，再用 `zipalign -c -P 16` 断言 zip 条目也按 16 KB 排。真正提供对齐的是 NDK：r28 起默认按 16 KB max-page-size 链接共享库，workflow 钉的是 `28.2.13676358`。

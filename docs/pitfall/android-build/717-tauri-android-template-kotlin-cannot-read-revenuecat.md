# Tauri Android 模板的 Kotlin 读不了 RevenueCat 元数据

## 现象

用 Tauri CLI 2.11.4 模板里的 Kotlin 1.9.25 编译调用 RevenueCat 11.5.0 的 Kotlin 代码，编译器报元数据版本不兼容。

## 原因

RevenueCat SDK 的元数据是 2.1，其依赖的 Kotlin 标准库是 2.2.21。模板的 Android Gradle Plugin 8.11.0 已支持 Kotlin 2.2。

## 解法

用 `scripts/android-init.sh` 初始化 Android 项目，将生成项目的 Kotlin Gradle 插件升到 2.2.21。APK 和 Android 冒烟工作流共用这个脚本。

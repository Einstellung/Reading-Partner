// swift-tools-version:5.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

// The floor is the app's (docs/33), the same string every package in the build
// states. RevenueCat is pinned to its current major; at this tools version a
// remote package is named explicitly, and the product refers to it by that
// name.
let package = Package(
    name: "tauri-plugin-purchases",
    platforms: [
        .macOS("26.0"),
        .iOS("26.0"),
    ],
    products: [
        .library(
            name: "tauri-plugin-purchases",
            type: .static,
            targets: ["tauri-plugin-purchases"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        .package(
            name: "RevenueCat",
            url: "https://github.com/RevenueCat/purchases-ios.git",
            .upToNextMajor(from: "5.105.0")),
    ],
    targets: [
        .target(
            name: "tauri-plugin-purchases",
            dependencies: [
                .byName(name: "Tauri"),
                .product(name: "RevenueCat", package: "RevenueCat"),
            ],
            path: "Sources")
    ]
)

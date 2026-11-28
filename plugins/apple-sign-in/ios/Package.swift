// swift-tools-version:5.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

// The floor is the app's (docs/33), spelled as a string because the `.v26` case
// of SupportedPlatform postdates this tools version.
let package = Package(
    name: "tauri-plugin-apple-sign-in",
    platforms: [
        .macOS("26.0"),
        .iOS("26.0"),
    ],
    products: [
        .library(
            name: "tauri-plugin-apple-sign-in",
            type: .static,
            targets: ["tauri-plugin-apple-sign-in"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-apple-sign-in",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)

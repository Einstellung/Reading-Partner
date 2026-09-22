// swift-tools-version:5.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

// The floor is the app's, not this plugin's: UIActivityViewController is as old
// as iOS, but docs/33 raised the whole app's minimum system version to 26 and
// every package in the build states the same one. The version is spelled as a
// string because the `.v26` case of SupportedPlatform postdates this tools
// version.
let package = Package(
    name: "tauri-plugin-openin",
    platforms: [
        .macOS("26.0"),
        .iOS("26.0"),
    ],
    products: [
        // Products define the executables and libraries a package produces, and make them visible to other packages.
        .library(
            name: "tauri-plugin-openin",
            type: .static,
            targets: ["tauri-plugin-openin"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        // Targets are the basic building blocks of a package. A target can define a module or a test suite.
        // Targets can depend on other targets in this package, and on products in packages this package depends on.
        .target(
            name: "tauri-plugin-openin",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)

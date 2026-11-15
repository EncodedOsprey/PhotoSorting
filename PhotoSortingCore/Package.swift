// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PhotoSortingCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "PhotoSortingCore", targets: ["PhotoSortingCore"])
    ],
    targets: [
        .target(name: "PhotoSortingCore"),
        .testTarget(name: "PhotoSortingCoreTests", dependencies: ["PhotoSortingCore"])
    ]
)

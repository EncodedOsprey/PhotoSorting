import XCTest
@testable import PhotoSortingCore

final class ImageMetricsTests: XCTestCase {
    func testLaplacianVariance() {
        let w = 32, h = 32
        let flat = [UInt8](repeating: 128, count: w * h)
        XCTAssertEqual(ImageMetrics.laplacianVariance(gray: flat, width: w, height: h), 0)

        let checker = (0..<(w * h)).map { i -> UInt8 in ((i % w + i / w) % 2 == 0) ? 0 : 255 }
        let gradient = (0..<(w * h)).map { i -> UInt8 in UInt8((i % w) * 8) }
        let checkerVar = ImageMetrics.laplacianVariance(gray: checker, width: w, height: h)
        let gradientVar = ImageMetrics.laplacianVariance(gray: gradient, width: w, height: h)
        XCTAssertGreaterThan(checkerVar, gradientVar)
        XCTAssertEqual(ImageMetrics.laplacianVariance(gray: [1, 2, 3, 4], width: 2, height: 2), 0)

        XCTAssertGreaterThan(ImageMetrics.sharpnessScore(laplacianVariance: 500), ImageMetrics.sharpnessScore(laplacianVariance: 50))
        XCTAssertLessThanOrEqual(ImageMetrics.sharpnessScore(laplacianVariance: 1e9), 1)
    }

    func testExposure() {
        let mid = ImageMetrics.exposureScore(gray: [UInt8](repeating: 128, count: 100))
        let black = ImageMetrics.exposureScore(gray: [UInt8](repeating: 0, count: 100))
        let white = ImageMetrics.exposureScore(gray: [UInt8](repeating: 255, count: 100))
        XCTAssertGreaterThan(mid, 0.9)
        XCTAssertGreaterThan(mid, black)
        XCTAssertGreaterThan(mid, white)
        XCTAssertEqual(ImageMetrics.exposureScore(gray: []), 0)
    }
}

final class FaceGeometryTests: XCTestCase {
    private func eye(height: Double) -> [Point2D] {
        [Point2D(x: 0, y: 0), Point2D(x: 0.5, y: height / 2), Point2D(x: 1, y: 0), Point2D(x: 0.5, y: -height / 2)]
    }

    func testEyeOpennessMonotonic() {
        let values = [0.05, 0.15, 0.2, 0.25, 0.4].map { FaceGeometry.eyeOpenness(eye: eye(height: $0)) }
        XCTAssertEqual(values.first, 0)
        XCTAssertEqual(values.last, 1)
        XCTAssertEqual(values, values.sorted())
        XCTAssertEqual(FaceGeometry.eyeOpenness(eye: [Point2D(x: 0, y: 0)]), 0.5)
    }

    private func lips(width: Double, lift: Double) -> [Point2D] {
        let cx = 0.5, cy = 0.25
        return [
            Point2D(x: cx - width / 2, y: cy + lift),
            Point2D(x: cx - width / 4, y: cy + 0.02),
            Point2D(x: cx, y: cy + 0.03),
            Point2D(x: cx + width / 4, y: cy + 0.02),
            Point2D(x: cx + width / 2, y: cy + lift),
            Point2D(x: cx + width / 4, y: cy - 0.03),
            Point2D(x: cx, y: cy - 0.04),
            Point2D(x: cx - width / 4, y: cy - 0.03),
        ]
    }

    func testSmileMonotonic() {
        let neutral = FaceGeometry.smileScore(outerLips: lips(width: 0.36, lift: 0))
        let wider = FaceGeometry.smileScore(outerLips: lips(width: 0.5, lift: 0))
        let broad = FaceGeometry.smileScore(outerLips: lips(width: 0.5, lift: 0.05))
        XCTAssertLessThan(neutral, wider)
        XCTAssertLessThan(wider, broad)
        XCTAssertGreaterThan(broad, 0.8)
        XCTAssertEqual(FaceGeometry.smileScore(outerLips: [Point2D(x: 0, y: 0), Point2D(x: 1, y: 0)]), 0)
    }

    func testMatchFaces() {
        let primary = [
            Rect2D(x: 0.1, y: 0.1, width: 0.2, height: 0.2),
            Rect2D(x: 0.6, y: 0.6, width: 0.2, height: 0.2),
            Rect2D(x: 0.6, y: 0.1, width: 0.05, height: 0.05),
        ]
        let secondary = [
            Rect2D(x: 0.62, y: 0.62, width: 0.2, height: 0.2),
            Rect2D(x: 0.11, y: 0.1, width: 0.2, height: 0.2),
            Rect2D(x: 0.15, y: 0.12, width: 0.2, height: 0.2),
        ]
        XCTAssertEqual(FaceGeometry.matchFaces(primary, to: secondary), [1, 0, nil])

        // Fallback: tiny secondary inside the primary (low IoU) matched by center distance.
        let small = [Rect2D(x: 0.18, y: 0.18, width: 0.03, height: 0.03)]
        XCTAssertEqual(FaceGeometry.matchFaces([primary[0]], to: small), [0])
        XCTAssertEqual(FaceGeometry.matchFaces(primary, to: []), [nil, nil, nil])
    }
}

final class SimilarityClustererTests: XCTestCase {
    func testTransitiveClustersAndSingletons() {
        // Values: 0, 1, 2 chain within threshold 1.0; 10 alone; 20, 20.5 pair.
        let values: [Double] = [0, 1, 2, 10, 20, 20.5]
        let ids = SimilarityClusterer.cluster(count: values.count, window: 1, threshold: 1.0) { abs(values[$0] - values[$1]) }
        XCTAssertEqual(ids, [0, 0, 0, nil, 1, 1])
    }

    func testWindowLimitsComparisons() {
        let values: [Double] = [0, 100, 0.5]
        let narrow = SimilarityClusterer.cluster(count: 3, window: 1, threshold: 1) { abs(values[$0] - values[$1]) }
        XCTAssertEqual(narrow, [nil, nil, nil])
        let wide = SimilarityClusterer.cluster(count: 3, window: 2, threshold: 1) { abs(values[$0] - values[$1]) }
        XCTAssertEqual(wide, [0, nil, 0])
    }

    func testUnknownDistancesSkipped() {
        let ids = SimilarityClusterer.cluster(count: 3, window: 5, threshold: 1) { _, _ in nil }
        XCTAssertEqual(ids, [nil, nil, nil])
        XCTAssertEqual(SimilarityClusterer.cluster(count: 0, window: 5, threshold: 1) { _, _ in 0 }, [])
    }
}

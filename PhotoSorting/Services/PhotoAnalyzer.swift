import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Photos
import UIKit
import Vision
import PhotoSortingCore

/// The cached result of analyzing one asset.
struct AnalyzedPhoto: @unchecked Sendable {
    let id: String
    let metrics: PhotoMetrics
    /// Used for near-duplicate detection; nil if Vision couldn't produce one.
    let featurePrint: VNFeaturePrintObservation?
}

/// Measures photos on-device with Vision, Core Image and the core `ImageMetrics`/`FaceGeometry` helpers.
///
/// Thread-safety: all stored properties are immutable; `CIContext` is thread-safe and the shared
/// `CIDetector` is only used under `detectorLock`. Vision handlers are created per image.
final class PhotoAnalyzer: @unchecked Sendable {
    struct Outcome: Sendable {
        var results: [String: AnalyzedPhoto] = [:]
        var failedIDs: [String] = []
    }

    /// Long edge of the image requested from PhotoKit for analysis.
    static let analysisLongEdge: CGFloat = 1024
    /// Long edge the sharpness/exposure buffers are scaled to (what `ImageMetrics.sharpnessScore` is calibrated for).
    static let metricsLongEdge: Double = 512

    private let ciContext: CIContext
    private let faceDetector: CIDetector?
    private let detectorLock = NSLock()

    init() {
        let context = CIContext()
        ciContext = context
        faceDetector = CIDetector(
            ofType: CIDetectorTypeFace,
            context: context,
            options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
        )
    }

    // MARK: Batch

    /// Analyzes `refs` with at most `maxConcurrent` photos in flight. Stops starting new work when the
    /// calling task is cancelled and returns whatever finished. `progress` receives (completed, failed).
    func analyze(
        _ refs: [AssetRef],
        maxConcurrent: Int = 4,
        progress: @escaping @MainActor @Sendable (Int, Int) -> Void
    ) async -> Outcome {
        guard !refs.isEmpty else { return Outcome() }

        return await withTaskGroup(of: (String, AnalyzedPhoto?).self, returning: Outcome.self) { group in
            var outcome = Outcome()
            var nextIndex = 0
            var completed = 0
            let width = max(1, min(maxConcurrent, refs.count))

            while nextIndex < width {
                let ref = refs[nextIndex]
                nextIndex += 1
                group.addTask {
                    let photo = await self.analyzeAsset(ref.asset)
                    return (ref.id, photo)
                }
            }

            while let item = await group.next() {
                completed += 1
                if let photo = item.1 {
                    outcome.results[item.0] = photo
                } else if !Task.isCancelled {
                    outcome.failedIDs.append(item.0)
                }
                await progress(completed, outcome.failedIDs.count)

                if !Task.isCancelled, nextIndex < refs.count {
                    let ref = refs[nextIndex]
                    nextIndex += 1
                    group.addTask {
                        let photo = await self.analyzeAsset(ref.asset)
                        return (ref.id, photo)
                    }
                }
            }
            return outcome
        }
    }

    // MARK: Single photo

    func analyzeAsset(_ asset: PHAsset) async -> AnalyzedPhoto? {
        let id = asset.localIdentifier
        guard !Task.isCancelled else { return nil }

        let target = CGSize(width: Self.analysisLongEdge, height: Self.analysisLongEdge)
        guard
            let image = await ImageLoader.image(for: asset, targetSize: target),
            let cgImage = image.cgImage,
            !Task.isCancelled
        else {
            return nil
        }

        let orientation = CGImagePropertyOrientation(uiOrientation: image.imageOrientation)
        let measured = measure(cgImage: cgImage, orientation: orientation)
        var metrics = measured.metrics

        if #available(iOS 18.0, *) {
            if let aesthetics = await aestheticsScores(cgImage: cgImage, orientation: orientation) {
                metrics.aesthetics = aesthetics.score
                metrics.isUtility = aesthetics.isUtility
            }
        }

        return AnalyzedPhoto(id: id, metrics: metrics, featurePrint: measured.featurePrint)
    }

    private func measure(
        cgImage: CGImage,
        orientation: CGImagePropertyOrientation
    ) -> (metrics: PhotoMetrics, featurePrint: VNFeaturePrintObservation?) {
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])

        // Faces + landmarks.
        let landmarksRequest = VNDetectFaceLandmarksRequest()
        var faces: [VNFaceObservation] = []
        do {
            try handler.perform([landmarksRequest])
            faces = landmarksRequest.results ?? []
        } catch {
            faces = []
        }

        // Face capture quality, run on the faces found above.
        var qualities = [Double?](repeating: nil, count: faces.count)
        if !faces.isEmpty {
            let qualityRequest = VNDetectFaceCaptureQualityRequest()
            qualityRequest.inputFaceObservations = faces
            do {
                try handler.perform([qualityRequest])
                let scored = qualityRequest.results ?? []
                if !scored.isEmpty {
                    let matches = FaceGeometry.matchFaces(
                        faces.map { Self.rect2D($0.boundingBox) },
                        to: scored.map { Self.rect2D($0.boundingBox) }
                    )
                    for (index, match) in matches.enumerated() where index < qualities.count {
                        if let match, match >= 0, match < scored.count, let quality = scored[match].faceCaptureQuality {
                            qualities[index] = Self.clamp(Double(quality))
                        }
                    }
                }
            } catch {
                // Capture quality is optional.
            }
        }

        // Feature print for near-duplicate detection.
        let featurePrintRequest = VNGenerateImageFeaturePrintRequest()
        featurePrintRequest.revision = VNGenerateImageFeaturePrintRequestRevision2
        var featurePrint: VNFeaturePrintObservation?
        do {
            try handler.perform([featurePrintRequest])
            featurePrint = featurePrintRequest.results?.first
        } catch {
            featurePrint = nil
        }

        // Core Image smile / blink detection, in the same oriented, bottom-left-origin space as Vision.
        let orientedImage = CIImage(cgImage: cgImage).oriented(orientation)
        let extent = orientedImage.extent
        var ciFaces: [CIFaceFeature] = []
        if !faces.isEmpty, let detector = faceDetector, extent.width > 0, extent.height > 0 {
            ciFaces = detectorLock.withLock {
                detector
                    .features(in: orientedImage, options: [CIDetectorSmile: true, CIDetectorEyeBlink: true])
                    .compactMap { $0 as? CIFaceFeature }
            }
        }

        var ciMatches = [Int?](repeating: nil, count: faces.count)
        if !ciFaces.isEmpty {
            let ciRects = ciFaces.map { feature in
                PhotoSortingCore.Rect2D(
                    x: Double((feature.bounds.minX - extent.minX) / extent.width),
                    y: Double((feature.bounds.minY - extent.minY) / extent.height),
                    width: Double(feature.bounds.width / extent.width),
                    height: Double(feature.bounds.height / extent.height)
                )
            }
            let matches = FaceGeometry.matchFaces(faces.map { Self.rect2D($0.boundingBox) }, to: ciRects)
            for (index, match) in matches.enumerated() where index < ciMatches.count {
                ciMatches[index] = match
            }
        }

        var faceMetrics: [FaceMetrics] = []
        for (index, face) in faces.enumerated() {
            var ciFace: CIFaceFeature?
            if let match = ciMatches[index], match >= 0, match < ciFaces.count {
                ciFace = ciFaces[match]
            }
            faceMetrics.append(Self.faceMetrics(for: face, ciFace: ciFace, captureQuality: qualities[index]))
        }

        // Sharpness and exposure on a ~512 px grayscale copy.
        let scale = min(1.0, Self.metricsLongEdge / Double(max(cgImage.width, cgImage.height, 1)))
        var sharpness = 0.0
        var exposure = 0.5
        if let gray = Self.grayPixels(from: cgImage, scale: scale) {
            let variance = ImageMetrics.laplacianVariance(gray: gray.pixels, width: gray.width, height: gray.height)
            sharpness = ImageMetrics.sharpnessScore(laplacianVariance: variance)
            exposure = ImageMetrics.exposureScore(gray: gray.pixels)
        }

        // A sharp subject on a soft (bokeh) background is still a sharp photo: also measure the largest face.
        if let largestFace = faces.max(by: { Self.area($0.boundingBox) < Self.area($1.boundingBox) }),
           let faceScore = faceSharpness(in: orientedImage, normalizedFace: largestFace.boundingBox, scale: scale) {
            sharpness = max(sharpness, faceScore)
        }

        let metrics = PhotoMetrics(
            faces: faceMetrics,
            sharpness: Self.clamp(sharpness),
            exposure: Self.clamp(exposure)
        )
        return (metrics: metrics, featurePrint: featurePrint)
    }

    private static func faceMetrics(
        for face: VNFaceObservation,
        ciFace: CIFaceFeature?,
        captureQuality: Double?
    ) -> FaceMetrics {
        let landmarks = face.landmarks

        var eyeScores: [Double] = []
        if let left = landmarks?.leftEye?.normalizedPoints, !left.isEmpty {
            eyeScores.append(FaceGeometry.eyeOpenness(eye: points(left)))
        }
        if let right = landmarks?.rightEye?.normalizedPoints, !right.isEmpty {
            eyeScores.append(FaceGeometry.eyeOpenness(eye: points(right)))
        }
        var eyesOpen = eyeScores.isEmpty ? 0.5 : eyeScores.reduce(0, +) / Double(eyeScores.count)

        var smile = 0.0
        if let lips = landmarks?.outerLips?.normalizedPoints, !lips.isEmpty {
            smile = FaceGeometry.smileScore(outerLips: points(lips))
        }

        if let ciFace {
            smile = 0.55 * (ciFace.hasSmile ? 1 : 0) + 0.45 * smile
            let closedEyes = (ciFace.leftEyeClosed ? 1 : 0) + (ciFace.rightEyeClosed ? 1 : 0)
            switch closedEyes {
            case 0: eyesOpen = 0.75 * eyesOpen + 0.25
            case 1: eyesOpen = min(eyesOpen, 0.45)
            default: eyesOpen = min(eyesOpen, 0.15)
            }
        }

        return FaceMetrics(
            smile: clamp(smile),
            eyesOpen: clamp(eyesOpen),
            captureQuality: captureQuality,
            areaFraction: clamp(area(face.boundingBox))
        )
    }

    /// Sharpness of the (slightly padded) face region, sampled at the same scale as the whole image.
    private func faceSharpness(in orientedImage: CIImage, normalizedFace: CGRect, scale: Double) -> Double? {
        let extent = orientedImage.extent
        guard extent.width > 0, extent.height > 0 else { return nil }

        let faceRect = CGRect(
            x: extent.minX + normalizedFace.minX * extent.width,
            y: extent.minY + normalizedFace.minY * extent.height,
            width: normalizedFace.width * extent.width,
            height: normalizedFace.height * extent.height
        )
        let cropRect = faceRect
            .insetBy(dx: -faceRect.width * 0.1, dy: -faceRect.height * 0.1)
            .integral
            .intersection(extent)
        guard !cropRect.isNull,
              Double(cropRect.width) * scale >= 48,
              Double(cropRect.height) * scale >= 48,
              let crop = ciContext.createCGImage(orientedImage, from: cropRect),
              let gray = Self.grayPixels(from: crop, scale: scale)
        else {
            return nil
        }
        let variance = ImageMetrics.laplacianVariance(gray: gray.pixels, width: gray.width, height: gray.height)
        return ImageMetrics.sharpnessScore(laplacianVariance: variance)
    }

    @available(iOS 18.0, *)
    private func aestheticsScores(
        cgImage: CGImage,
        orientation: CGImagePropertyOrientation
    ) async -> (score: Double, isUtility: Bool)? {
        do {
            let request = CalculateImageAestheticsScoresRequest()
            let observation = try await request.perform(on: cgImage, orientation: orientation)
            let score = (Double(observation.overallScore) + 1) / 2
            return (score: Self.clamp(score), isUtility: observation.isUtility)
        } catch {
            return nil
        }
    }

    // MARK: Helpers

    /// Distance between two feature prints, or nil if either is missing or Vision fails.
    static func distance(_ a: VNFeaturePrintObservation?, _ b: VNFeaturePrintObservation?) -> Double? {
        guard let a, let b else { return nil }
        var distance: Float = 0
        do {
            try a.computeDistance(&distance, to: b)
        } catch {
            return nil
        }
        return Double(distance)
    }

    /// Renders `image` into an 8-bit grayscale buffer scaled by `scale`.
    static func grayPixels(from image: CGImage, scale: Double) -> (pixels: [UInt8], width: Int, height: Int)? {
        let width = max(1, Int((Double(image.width) * scale).rounded()))
        let height = max(1, Int((Double(image.height) * scale).rounded()))
        guard image.width > 0, image.height > 0 else { return nil }

        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else {
                return false
            }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        return (pixels: pixels, width: width, height: height)
    }

    private static func points(_ cgPoints: [CGPoint]) -> [PhotoSortingCore.Point2D] {
        cgPoints.map { PhotoSortingCore.Point2D(x: Double($0.x), y: Double($0.y)) }
    }

    private static func rect2D(_ rect: CGRect) -> PhotoSortingCore.Rect2D {
        PhotoSortingCore.Rect2D(
            x: Double(rect.origin.x),
            y: Double(rect.origin.y),
            width: Double(rect.width),
            height: Double(rect.height)
        )
    }

    private static func area(_ rect: CGRect) -> Double {
        Double(max(0, rect.width) * max(0, rect.height))
    }

    private static func clamp(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(1, max(0, value))
    }
}

import Foundation

/// Pixel-level image quality measurements on 8-bit grayscale buffers.
public enum ImageMetrics {
    /// Variance of the 3x3 Laplacian (4-neighbour kernel) over an 8-bit grayscale buffer (row-major, width*height). Returns 0 for images smaller than 3x3.
    public static func laplacianVariance(gray: [UInt8], width: Int, height: Int) -> Double {
        guard width >= 3, height >= 3, gray.count >= width * height else { return 0 }
        var sum = 0.0
        var sumSquares = 0.0
        var n = 0.0
        gray.withUnsafeBufferPointer { p in
            for y in 1..<(height - 1) {
                let row = y * width
                for x in 1..<(width - 1) {
                    let i = row + x
                    let lap = Int(p[i - width]) + Int(p[i + width]) + Int(p[i - 1]) + Int(p[i + 1]) - 4 * Int(p[i])
                    let v = Double(lap)
                    sum += v
                    sumSquares += v * v
                    n += 1
                }
            }
        }
        guard n > 0 else { return 0 }
        let mean = sum / n
        return max(0, sumSquares / n - mean * mean)
    }

    /// Maps Laplacian variance (computed on ~512px-long-edge images) to 0...1, monotonic, saturating.
    public static func sharpnessScore(laplacianVariance: Double) -> Double {
        guard laplacianVariance.isFinite, laplacianVariance > 0 else { return 0 }
        let k = 150.0
        return laplacianVariance / (laplacianVariance + k)
    }

    /// Convenience: `sharpnessScore(laplacianVariance: laplacianVariance(gray:width:height:))`.
    public static func sharpnessScore(gray: [UInt8], width: Int, height: Int) -> Double {
        sharpnessScore(laplacianVariance: laplacianVariance(gray: gray, width: width, height: height))
    }

    /// 0...1 exposure quality from grayscale pixels: best when mean luminance ~0.45-0.55 of range, penalize clipped highlights (>=250) and crushed shadows (<=5) fractions. Empty -> 0.
    public static func exposureScore(gray: [UInt8]) -> Double {
        guard !gray.isEmpty else { return 0 }
        var sum = 0
        var clipped = 0
        var crushed = 0
        for v in gray {
            sum += Int(v)
            if v >= 250 { clipped += 1 }
            if v <= 5 { crushed += 1 }
        }
        let count = Double(gray.count)
        let mean = Double(sum) / count / 255
        // Full credit in 0.45...0.55, linear falloff to 0 at the extremes.
        let distance = max(0, abs(mean - 0.5) - 0.05)
        let meanScore = max(0, 1 - distance / 0.45)
        let clipPenalty = 1.5 * Double(clipped) / count + 1.5 * Double(crushed) / count
        return clamp01(meanScore - clipPenalty)
    }
}

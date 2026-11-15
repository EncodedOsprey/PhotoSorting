import Foundation

/// Geometry helpers for interpreting face landmarks and matching face observations.
public enum FaceGeometry {
    /// Eye openness 0...1 from an eye contour (normalized to face bbox) using the eye aspect ratio.
    public static func eyeOpenness(eye: [Point2D]) -> Double {
        guard eye.count >= 2, let box = boundingBox(eye), box.width > 0 else { return 0.5 }
        let ear = box.height / box.width
        return clamp01((ear - 0.12) / (0.30 - 0.12))
    }

    /// Smile 0...1 from outer-lips landmark points normalized to the face bounding box (origin bottom-left, y up).
    public static func smileScore(outerLips: [Point2D]) -> Double {
        guard outerLips.count >= 3, let box = boundingBox(outerLips), box.width > 0 else { return 0 }
        let mouthWidth = box.width
        let widthScore = clamp01((mouthWidth - 0.36) / (0.52 - 0.36))

        guard let left = outerLips.min(by: { $0.x < $1.x }),
              let right = outerLips.max(by: { $0.x < $1.x }) else { return 0 }
        let meanY = outerLips.reduce(0) { $0 + $1.y } / Double(outerLips.count)
        let lift = ((left.y + right.y) / 2 - meanY) / mouthWidth
        // Neutral corners sit ~at mean height; raised by ~12% of mouth width reads as a clear smile.
        let liftScore = clamp01((lift + 0.02) / 0.14)

        return clamp01(0.5 * widthScore + 0.5 * liftScore)
    }

    /// For each primary rect, index of best-matching secondary rect by IoU (>0.1) or else nearest center within max(primary.width, primary.height). Each secondary used at most once. nil if none.
    public static func matchFaces(_ primary: [Rect2D], to secondary: [Rect2D]) -> [Int?] {
        var result = [Int?](repeating: nil, count: primary.count)
        var usedSecondary = Set<Int>()

        var iouPairs: [(p: Int, s: Int, iou: Double)] = []
        for (p, pr) in primary.enumerated() {
            for (s, sr) in secondary.enumerated() {
                let value = iou(pr, sr)
                if value > 0.1 { iouPairs.append((p, s, value)) }
            }
        }
        iouPairs.sort { $0.iou != $1.iou ? $0.iou > $1.iou : ($0.p, $0.s) < ($1.p, $1.s) }
        for pair in iouPairs where result[pair.p] == nil && !usedSecondary.contains(pair.s) {
            result[pair.p] = pair.s
            usedSecondary.insert(pair.s)
        }

        var distPairs: [(p: Int, s: Int, d: Double)] = []
        for (p, pr) in primary.enumerated() where result[p] == nil {
            let limit = max(pr.width, pr.height)
            for (s, sr) in secondary.enumerated() where !usedSecondary.contains(s) {
                let d = hypot(pr.midX - sr.midX, pr.midY - sr.midY)
                if d <= limit { distPairs.append((p, s, d)) }
            }
        }
        distPairs.sort { $0.d != $1.d ? $0.d < $1.d : ($0.p, $0.s) < ($1.p, $1.s) }
        for pair in distPairs where result[pair.p] == nil && !usedSecondary.contains(pair.s) {
            result[pair.p] = pair.s
            usedSecondary.insert(pair.s)
        }
        return result
    }

    static func iou(_ a: Rect2D, _ b: Rect2D) -> Double {
        let w = min(a.x + a.width, b.x + b.width) - max(a.x, b.x)
        let h = min(a.y + a.height, b.y + b.height) - max(a.y, b.y)
        guard w > 0, h > 0 else { return 0 }
        let inter = w * h
        let union = a.area + b.area - inter
        return union > 0 ? inter / union : 0
    }

    private static func boundingBox(_ points: [Point2D]) -> Rect2D? {
        guard let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
              let minY = points.map(\.y).min(), let maxY = points.map(\.y).max() else { return nil }
        return Rect2D(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

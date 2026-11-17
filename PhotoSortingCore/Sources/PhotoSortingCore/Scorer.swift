import Foundation

@inline(__always)
func clamp01(_ value: Double) -> Double {
    guard value.isFinite else { return 0 }
    return min(1, max(0, value))
}

/// Scores photos for each `SelectionCategory`. All outputs are in 0...1.
public enum Scorer {
    /// 0...1 score of a photo for a category (higher is better).
    public static func score(_ metrics: PhotoMetrics, for category: SelectionCategory) -> Double {
        let sharp = clamp01(metrics.sharpness)
        let exposure = clamp01(metrics.exposure)
        let faces = metrics.faces

        switch category {
        case .bestSmiles:
            guard !faces.isEmpty else { return 0 }
            let smile = 0.6 * minSmile(faces) + 0.4 * meanSmile(faces)
            var parts: [(Double?, Double)] = [(smile, 0.55), (minEyes(faces), 0.25), (sharp, 0.1)]
            if let q = meanQuality(faces) { parts.append((q, 0.1)) }
            return weighted(parts)

        case .eyesOpen:
            guard !faces.isEmpty else { return 0 }
            var parts: [(Double?, Double)] = [(minEyes(faces), 0.7), (sharp, 0.15)]
            if let q = meanQuality(faces) { parts.append((q, 0.15)) }
            return weighted(parts)

        case .sharpest:
            return weighted([(sharp, 0.85), (exposure, 0.15)])

        case .wellExposed:
            return weighted([(exposure, 0.85), (sharp, 0.15)])

        case .groupShots:
            guard !faces.isEmpty else { return 0 }
            // Saturating bonus: 3 faces -> ~0.4, 10+ faces -> ~0.8.
            let sizeBonus = clamp01(1 - exp(-Double(faces.count) / 6))
            return weighted([
                (minEyes(faces), 0.35),
                (meanSmile(faces), 0.3),
                (sharp, 0.25),
                (sizeBonus, 0.1),
            ])

        case .portraits:
            guard !faces.isEmpty else { return 0 }
            let quality = meanQuality(faces) ?? meanEyes(faces).map { (meanSmile(faces) + $0) / 2 } ?? meanSmile(faces)
            let largest = faces.map { clamp01($0.areaFraction) }.max() ?? 0
            // Saturates around 25% of the frame.
            let sizeBonus = clamp01(largest / 0.25)
            return weighted([
                (quality, 0.3),
                (minEyes(faces), 0.2),
                (meanSmile(faces), 0.15),
                (sharp, 0.2),
                (sizeBonus, 0.15),
            ])

        case .noPeople:
            let technical = weighted([(sharp, 0.5), (exposure, 0.5)])
            if let a = metrics.aesthetics {
                return clamp01(0.6 * clamp01(a) + 0.4 * technical)
            }
            return technical

        case .bestOverall:
            return overall(metrics)
        }
    }

    /// Whether a photo can be considered for a category at all.
    public static func isEligible(_ metrics: PhotoMetrics, for category: SelectionCategory) -> Bool {
        if metrics.isUtility { return false }
        switch category {
        case .bestSmiles:
            return metrics.faceCount >= 1
        case .eyesOpen:
            return metrics.faceCount >= 1
                && metrics.faces.allSatisfy { $0.eyesVisible && clamp01($0.eyesOpen) >= SelectionPlan.eyesOpenMinimum }
        case .groupShots:
            return metrics.faceCount >= 3
        case .portraits:
            guard (1...2).contains(metrics.faceCount) else { return false }
            let largest = metrics.faces.map(\.areaFraction).max() ?? 0
            return largest >= 0.02
        case .noPeople:
            return metrics.faceCount == 0
        case .sharpest, .wellExposed, .bestOverall:
            return true
        }
    }

    /// Whether any face has closed eyes (the plan's "skip closed eyes" filter); hidden eyes don't count as closed.
    public static func hasClosedEyes(_ metrics: PhotoMetrics) -> Bool {
        metrics.faces.contains { $0.eyesVisible && $0.eyesOpen < SelectionPlan.closedEyesThreshold }
    }

    /// 0...1 general quality score (used by .bestOverall).
    public static func overall(_ metrics: PhotoMetrics) -> Double {
        var parts: [(Double?, Double)] = [
            (clamp01(metrics.sharpness), 0.3),
            (clamp01(metrics.exposure), 0.2),
        ]
        if let a = metrics.aesthetics { parts.append((clamp01(a), 0.25)) }
        let faces = metrics.faces
        if !faces.isEmpty {
            parts.append((0.6 * minSmile(faces) + 0.4 * meanSmile(faces), 0.1))
            parts.append((minEyes(faces), 0.15))
            if let q = meanQuality(faces) { parts.append((q, 0.1)) }
        }
        return weighted(parts)
    }

    // MARK: - Helpers

    /// Weighted mean with weights renormalized over the available components (a nil value is left out).
    private static func weighted(_ parts: [(value: Double?, weight: Double)]) -> Double {
        let available = parts.compactMap { part in part.value.map { (value: $0, weight: part.weight) } }
        let total = available.reduce(0) { $0 + $1.weight }
        guard total > 0 else { return 0 }
        return clamp01(available.reduce(0) { $0 + clamp01($1.value) * $1.weight } / total)
    }

    private static func minSmile(_ faces: [FaceMetrics]) -> Double {
        faces.map { clamp01($0.smile) }.min() ?? 0
    }

    private static func meanSmile(_ faces: [FaceMetrics]) -> Double {
        faces.isEmpty ? 0 : faces.reduce(0) { $0 + clamp01($1.smile) } / Double(faces.count)
    }

    /// Weakest eyes among the faces whose eyes are visible; nil when no face's are.
    private static func minEyes(_ faces: [FaceMetrics]) -> Double? {
        faces.filter(\.eyesVisible).map { clamp01($0.eyesOpen) }.min()
    }

    /// Mean eyes over the faces whose eyes are visible; nil when no face's are.
    private static func meanEyes(_ faces: [FaceMetrics]) -> Double? {
        let visible = faces.filter(\.eyesVisible)
        return visible.isEmpty ? nil : visible.reduce(0) { $0 + clamp01($1.eyesOpen) } / Double(visible.count)
    }

    private static func meanQuality(_ faces: [FaceMetrics]) -> Double? {
        let qs = faces.compactMap(\.captureQuality).map(clamp01)
        return qs.isEmpty ? nil : qs.reduce(0, +) / Double(qs.count)
    }
}

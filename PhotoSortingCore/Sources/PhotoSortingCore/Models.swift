import Foundation

/// A kind of "best photo" the photographer can ask for.
public enum SelectionCategory: String, CaseIterable, Codable, Identifiable, Hashable, Sendable {
    case bestSmiles
    case eyesOpen
    case sharpest
    case wellExposed
    case groupShots
    case portraits
    case noPeople
    case bestOverall

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .bestSmiles: return "Best Smiles"
        case .eyesOpen: return "Eyes Open"
        case .sharpest: return "Sharpest Focus"
        case .wellExposed: return "Best Exposure"
        case .groupShots: return "Group Shots"
        case .portraits: return "Portraits"
        case .noPeople: return "Scenery & Details"
        case .bestOverall: return "Best Overall"
        }
    }

    public var summary: String {
        switch self {
        case .bestSmiles: return "Everyone smiling, with eyes open."
        case .eyesOpen: return "No blinks — every face has open eyes."
        case .sharpest: return "Crisp focus with no motion blur."
        case .wellExposed: return "Balanced brightness, no blown highlights or crushed shadows."
        case .groupShots: return "Three or more people, all looking good."
        case .portraits: return "One or two people, close up, high face quality."
        case .noPeople: return "Venue, decor, detail and landscape shots without faces."
        case .bestOverall: return "Highest combined quality score."
        }
    }

    /// SF Symbol name for UI.
    public var systemImage: String {
        switch self {
        case .bestSmiles: return "face.smiling"
        case .eyesOpen: return "eye"
        case .sharpest: return "camera.aperture"
        case .wellExposed: return "sun.max"
        case .groupShots: return "person.3"
        case .portraits: return "person.crop.square"
        case .noPeople: return "mountain.2"
        case .bestOverall: return "star"
        }
    }
}

/// Per-face measurements. All scores are normalized to 0...1.
public struct FaceMetrics: Codable, Hashable, Sendable {
    public var smile: Double
    public var eyesOpen: Double
    /// Vision face capture quality (0...1); nil when unavailable.
    public var captureQuality: Double?
    /// Fraction of the image area covered by the face bounding box (0...1).
    public var areaFraction: Double

    public init(smile: Double, eyesOpen: Double, captureQuality: Double? = nil, areaFraction: Double) {
        self.smile = smile
        self.eyesOpen = eyesOpen
        self.captureQuality = captureQuality
        self.areaFraction = areaFraction
    }
}

/// Measurements for a single photo. All scores are normalized to 0...1.
public struct PhotoMetrics: Codable, Hashable, Sendable {
    public var faces: [FaceMetrics]
    public var sharpness: Double
    public var exposure: Double
    /// Apple aesthetics score mapped to 0...1 (iOS 18+); nil when unavailable.
    public var aesthetics: Double?
    /// True for screenshots, receipts, documents etc. (iOS 18+ aesthetics request).
    public var isUtility: Bool

    public var faceCount: Int { faces.count }

    public init(faces: [FaceMetrics], sharpness: Double, exposure: Double, aesthetics: Double? = nil, isUtility: Bool = false) {
        self.faces = faces
        self.sharpness = sharpness
        self.exposure = exposure
        self.aesthetics = aesthetics
        self.isUtility = isUtility
    }
}

/// A photo ready for selection. `clusterID` groups near-duplicate frames (nil = unique).
public struct Candidate<ID: Hashable & Sendable>: Hashable, Sendable {
    public var id: ID
    public var metrics: PhotoMetrics
    public var clusterID: Int?

    public init(id: ID, metrics: PhotoMetrics, clusterID: Int? = nil) {
        self.id = id
        self.metrics = metrics
        self.clusterID = clusterID
    }
}

public struct SelectionRequest: Codable, Hashable, Identifiable, Sendable {
    public var category: SelectionCategory
    public var count: Int
    public var id: SelectionCategory { category }

    public init(category: SelectionCategory, count: Int) {
        self.category = category
        self.count = count
    }
}

public struct SelectionPlan: Codable, Hashable, Sendable {
    /// Total number of photos the photographer wants delivered.
    public var totalCount: Int
    /// Ordered per-category quotas; earlier requests get first pick.
    public var requests: [SelectionRequest]
    /// Fill (totalCount - sum of quotas) with the best remaining photos by overall score.
    public var fillRemainderWithBestOverall: Bool
    /// Never pick two photos from the same near-duplicate cluster.
    public var avoidNearDuplicates: Bool
    /// Skip photos whose sharpness is below `SelectionPlan.blurryThreshold`.
    public var excludeBlurry: Bool
    /// Skip photos where any face's eyesOpen is below `SelectionPlan.closedEyesThreshold`.
    public var excludeClosedEyes: Bool

    public static let blurryThreshold = 0.25
    public static let closedEyesThreshold = 0.3

    public init(
        totalCount: Int,
        requests: [SelectionRequest],
        fillRemainderWithBestOverall: Bool = true,
        avoidNearDuplicates: Bool = true,
        excludeBlurry: Bool = true,
        excludeClosedEyes: Bool = false
    ) {
        self.totalCount = totalCount
        self.requests = requests
        self.fillRemainderWithBestOverall = fillRemainderWithBestOverall
        self.avoidNearDuplicates = avoidNearDuplicates
        self.excludeBlurry = excludeBlurry
        self.excludeClosedEyes = excludeClosedEyes
    }

    /// Sum of all per-category quotas.
    public var requestedCount: Int { requests.reduce(0) { $0 + max(0, $1.count) } }
}

public enum PlanIssue: Hashable, Sendable {
    case totalMustBePositive
    case negativeCount(SelectionCategory)
    case duplicateCategory(SelectionCategory)
    /// Category quotas add up to more than the total.
    case quotasExceedTotal(requested: Int, total: Int)

    public var message: String {
        switch self {
        case .totalMustBePositive: return "Total photos must be at least 1."
        case .negativeCount(let c): return "\(c.displayName) count can't be negative."
        case .duplicateCategory(let c): return "\(c.displayName) is listed more than once."
        case .quotasExceedTotal(let r, let t): return "Category counts add up to \(r), which is more than the total of \(t)."
        }
    }
}

public struct Pick<ID: Hashable & Sendable>: Hashable, Sendable {
    public var id: ID
    /// The category this photo was picked for (`.bestOverall` for remainder fill).
    public var category: SelectionCategory
    public var score: Double

    public init(id: ID, category: SelectionCategory, score: Double) {
        self.id = id
        self.category = category
        self.score = score
    }
}

public struct SelectionResult<ID: Hashable & Sendable>: Sendable {
    /// Picks in order: each request's picks (best first), then the remainder fill.
    public var picks: [Pick<ID>]
    /// Categories that couldn't be filled, mapped to how many photos were missing.
    public var shortfalls: [SelectionCategory: Int]

    public init(picks: [Pick<ID>], shortfalls: [SelectionCategory: Int]) {
        self.picks = picks
        self.shortfalls = shortfalls
    }

    public func picks(for category: SelectionCategory) -> [Pick<ID>] {
        picks.filter { $0.category == category }
    }
}

/// Simple geometry types so the core stays platform independent (Vision uses normalized, bottom-left-origin coordinates).
public struct Point2D: Hashable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public struct Rect2D: Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    public var midX: Double { x + width / 2 }
    public var midY: Double { y + height / 2 }
    public var area: Double { max(0, width) * max(0, height) }
}

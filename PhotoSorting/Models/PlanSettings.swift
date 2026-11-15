import Foundation
import PhotoSortingCore

/// One row in the criteria list: a category, whether it's included, and how many photos it should get.
struct CategorySetting: Codable, Hashable, Identifiable, Sendable {
    var category: SelectionCategory
    var isEnabled: Bool
    var count: Int

    var id: SelectionCategory { category }
}

/// The photographer's selection preset. Persisted to `UserDefaults` as JSON so it survives relaunch.
struct PlanSettings: Codable, Equatable, Sendable {
    var totalCount: Int
    /// Every category, in priority order. Disabled rows keep their count and position.
    var categories: [CategorySetting]
    var fillRemainderWithBestOverall: Bool
    var avoidNearDuplicates: Bool
    /// Feature-print distance at or below which two neighbouring photos count as near-duplicates.
    var similarityThreshold: Double
    var excludeBlurry: Bool
    var excludeClosedEyes: Bool

    static let totalRange: ClosedRange<Int> = 1...999
    static let countRange: ClosedRange<Int> = 0...999
    static let similarityRange: ClosedRange<Double> = 0.3...0.8

    static let `default` = PlanSettings(
        totalCount: 20,
        categories: [
            CategorySetting(category: .bestSmiles, isEnabled: true, count: 8),
            CategorySetting(category: .groupShots, isEnabled: true, count: 4),
            CategorySetting(category: .portraits, isEnabled: true, count: 4),
            CategorySetting(category: .eyesOpen, isEnabled: false, count: 4),
            CategorySetting(category: .sharpest, isEnabled: false, count: 4),
            CategorySetting(category: .wellExposed, isEnabled: false, count: 4),
            CategorySetting(category: .noPeople, isEnabled: false, count: 4),
            CategorySetting(category: .bestOverall, isEnabled: false, count: 4)
        ],
        fillRemainderWithBestOverall: true,
        avoidNearDuplicates: true,
        similarityThreshold: 0.5,
        excludeBlurry: true,
        excludeClosedEyes: false
    )

    /// The plan handed to `PhotoSelector`.
    var plan: SelectionPlan {
        SelectionPlan(
            totalCount: totalCount,
            requests: categories
                .filter(\.isEnabled)
                .map { SelectionRequest(category: $0.category, count: $0.count) },
            fillRemainderWithBestOverall: fillRemainderWithBestOverall,
            avoidNearDuplicates: avoidNearDuplicates,
            excludeBlurry: excludeBlurry,
            excludeClosedEyes: excludeClosedEyes
        )
    }

    /// Repairs values that may come from an older or hand-edited preset.
    func normalized() -> PlanSettings {
        var copy = self
        copy.totalCount = min(max(totalCount, Self.totalRange.lowerBound), Self.totalRange.upperBound)
        copy.similarityThreshold = min(max(similarityThreshold, Self.similarityRange.lowerBound), Self.similarityRange.upperBound)

        var seen = Set<SelectionCategory>()
        var rows: [CategorySetting] = []
        for var row in categories where !seen.contains(row.category) {
            seen.insert(row.category)
            row.count = min(max(row.count, Self.countRange.lowerBound), Self.countRange.upperBound)
            rows.append(row)
        }
        for category in SelectionCategory.allCases where !seen.contains(category) {
            let fallback = Self.default.categories.first { $0.category == category }
            rows.append(CategorySetting(category: category, isEnabled: false, count: fallback?.count ?? 4))
        }
        copy.categories = rows
        return copy
    }

    // MARK: Persistence

    private static let storageKey = "PhotoSorting.planSettings.v1"

    static func load(from defaults: UserDefaults = .standard) -> PlanSettings {
        guard
            let data = defaults.data(forKey: storageKey),
            let settings = try? JSONDecoder().decode(PlanSettings.self, from: data)
        else {
            return .default
        }
        return settings.normalized()
    }

    func save(to defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) {
            defaults.set(data, forKey: Self.storageKey)
        }
    }
}

import Foundation

/// Picks photos according to a `SelectionPlan`.
public enum PhotoSelector {
    public static func validate(_ plan: SelectionPlan) -> [PlanIssue] {
        var issues: [PlanIssue] = []
        if plan.totalCount <= 0 { issues.append(.totalMustBePositive) }
        var seen = Set<SelectionCategory>()
        var reportedDuplicates = Set<SelectionCategory>()
        for request in plan.requests {
            if request.count < 0 { issues.append(.negativeCount(request.category)) }
            if !seen.insert(request.category).inserted, reportedDuplicates.insert(request.category).inserted {
                issues.append(.duplicateCategory(request.category))
            }
        }
        if plan.requestedCount > plan.totalCount {
            issues.append(.quotasExceedTotal(requested: plan.requestedCount, total: plan.totalCount))
        }
        return issues
    }

    public static func select<ID: Hashable & Sendable>(from candidates: [Candidate<ID>], plan: SelectionPlan) -> SelectionResult<ID> {
        let total = max(0, plan.totalCount)
        var picks: [Pick<ID>] = []
        var shortfalls: [SelectionCategory: Int] = [:]
        var usedIndices = Set<Int>()
        var usedClusters = Set<Int>()

        let passesFilters: [Bool] = candidates.map { candidate in
            let m = candidate.metrics
            if plan.excludeBlurry && m.sharpness < SelectionPlan.blurryThreshold { return false }
            if plan.excludeClosedEyes && Scorer.hasClosedEyes(m) { return false }
            return true
        }

        func take(_ category: SelectionCategory, count: Int) -> Int {
            let ranked = candidates.indices
                .filter { i in
                    !usedIndices.contains(i) && passesFilters[i] && Scorer.isEligible(candidates[i].metrics, for: category)
                }
                .map { (index: $0, score: Scorer.score(candidates[$0].metrics, for: category)) }
                .sorted { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }

            var taken = 0
            for entry in ranked where taken < count {
                let candidate = candidates[entry.index]
                if plan.avoidNearDuplicates, let cluster = candidate.clusterID {
                    if usedClusters.contains(cluster) { continue }
                    usedClusters.insert(cluster)
                }
                usedIndices.insert(entry.index)
                picks.append(Pick(id: candidate.id, category: category, score: entry.score))
                taken += 1
            }
            return taken
        }

        for request in plan.requests {
            let remaining = total - picks.count
            guard remaining > 0 else { break }
            let wanted = min(max(0, request.count), remaining)
            guard wanted > 0 else { continue }
            let got = take(request.category, count: wanted)
            if got < wanted {
                shortfalls[request.category, default: 0] += wanted - got
            }
        }

        if plan.fillRemainderWithBestOverall {
            let remaining = total - picks.count
            if remaining > 0 {
                let got = take(.bestOverall, count: remaining)
                if got < remaining {
                    shortfalls[.bestOverall, default: 0] += remaining - got
                }
            }
        }

        return SelectionResult(picks: picks, shortfalls: shortfalls)
    }
}

import Foundation

/// Groups near-duplicate photos (burst frames, re-takes) into clusters.
public enum SimilarityClusterer {
    /// Groups near-duplicate photos. Items are assumed sorted chronologically; each item i is compared to items in max(0,i-window)..<i via `distance(i, j)` (nil = unknown/skip). distance <= threshold => same cluster (union-find, transitive). Returns per-item cluster IDs; items alone in their cluster get nil. Cluster IDs are 0-based, consecutive, in order of first appearance.
    public static func cluster(count: Int, window: Int, threshold: Double, distance: (Int, Int) -> Double?) -> [Int?] {
        guard count > 0 else { return [] }
        var parent = Array(0..<count)

        func find(_ x: Int) -> Int {
            var root = x
            while parent[root] != root { root = parent[root] }
            var node = x
            while parent[node] != root {
                let next = parent[node]
                parent[node] = root
                node = next
            }
            return root
        }

        if window > 0 {
            for i in 1..<max(1, count) {
                for j in max(0, i - window)..<i {
                    guard let d = distance(i, j), d <= threshold else { continue }
                    let a = find(i), b = find(j)
                    if a != b { parent[max(a, b)] = min(a, b) }
                }
            }
        }

        let roots = (0..<count).map(find)
        var sizes: [Int: Int] = [:]
        for r in roots { sizes[r, default: 0] += 1 }

        var ids: [Int: Int] = [:]
        var result = [Int?](repeating: nil, count: count)
        for i in 0..<count {
            let r = roots[i]
            guard sizes[r, default: 0] > 1 else { continue }
            if let id = ids[r] {
                result[i] = id
            } else {
                let id = ids.count
                ids[r] = id
                result[i] = id
            }
        }
        return result
    }
}

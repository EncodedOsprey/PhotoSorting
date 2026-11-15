import Foundation
import Observation
import Photos
import PhotosUI
import SwiftUI
import Vision
import PhotoSortingCore

enum Route: Hashable {
    case albumPicker
    case analysis
    case results
}

enum LibraryAccess: Equatable {
    case notDetermined
    case denied
    case granted(limited: Bool)
}

struct AnalysisProgress: Equatable {
    var completed = 0
    var total = 0
    var failed = 0

    var fraction: Double {
        total == 0 ? 1 : min(1, Double(completed) / Double(total))
    }
}

/// One results section: a category's picks plus how many were asked for.
struct ResultSection: Identifiable {
    let category: SelectionCategory
    let picks: [Pick<String>]
    let requested: Int

    var id: SelectionCategory { category }
    var shortfall: Int { max(0, requested - picks.count) }
}

@MainActor
@Observable
final class AppModel {
    // MARK: Navigation & access

    var path: [Route] = []
    private(set) var authorization: PHAuthorizationStatus = PhotoLibraryService.authorizationStatus()

    var access: LibraryAccess {
        switch authorization {
        case .authorized: return .granted(limited: false)
        case .limited: return .granted(limited: true)
        case .notDetermined: return .notDetermined
        case .denied, .restricted: return .denied
        @unknown default: return .denied
        }
    }

    // MARK: Source

    var sourceMode: SourceMode = .album
    private(set) var albums: [AlbumInfo] = []
    private(set) var isLoadingAlbums = false
    var selectedAlbumID: String?
    var startDate: Date = AppModel.defaultStartDate()
    var endDate: Date = AppModel.defaultEndDate()
    var pickerItems: [PhotosPickerItem] = []
    var favoritesOnly = false
    var excludeScreenshots = true
    private(set) var foundAssets: [PHAsset] = []
    private(set) var isCounting = false
    private var libraryToken = 0

    var sourceQuery: SourceQuery {
        SourceQuery(
            mode: sourceMode,
            albumID: selectedAlbumID,
            startDate: startDate,
            endDate: endDate,
            pickedIDs: pickerItems.compactMap(\.itemIdentifier),
            favoritesOnly: favoritesOnly,
            excludeScreenshots: excludeScreenshots,
            libraryToken: libraryToken
        )
    }

    var selectedAlbum: AlbumInfo? {
        albums.first { $0.id == selectedAlbumID }
    }

    // MARK: Criteria

    var settings: PlanSettings = PlanSettings.load()

    var planIssues: [PlanIssue] {
        PhotoSelector.validate(settings.plan)
    }

    var canAnalyze: Bool {
        !foundAssets.isEmpty && !isCounting && planIssues.isEmpty && !isAnalyzing
    }

    var analyzeBlockedReason: String? {
        if isCounting { return nil }
        if foundAssets.isEmpty { return "No photos found for this source." }
        if !planIssues.isEmpty { return "Fix the selection criteria above." }
        return nil
    }

    // MARK: Analysis

    private(set) var progress = AnalysisProgress()
    private(set) var isAnalyzing = false
    /// Metrics and feature prints keyed by `PHAsset.localIdentifier`, reused across runs.
    @ObservationIgnored private var cache: [String: AnalyzedPhoto] = [:]
    @ObservationIgnored private var analysisTask: Task<Void, Never>?
    @ObservationIgnored private var runID = UUID()
    @ObservationIgnored private var clusterIDs: [String: Int] = [:]
    @ObservationIgnored private var clusterSignature: ClusterSignature?
    private let analyzer = PhotoAnalyzer()

    private struct ClusterSignature: Equatable {
        let ids: [String]
        let threshold: Double
    }

    // MARK: Results

    /// Successfully analyzed assets of the current run, in chronological order.
    private(set) var analyzedIDs: [String] = []
    private(set) var failedCount = 0
    private(set) var assetsByID: [String: PHAsset] = [:]
    private(set) var result: SelectionResult<String>?
    private(set) var resultPlan: SelectionPlan?
    private(set) var suggestedAlbumTitle = "Best Photos"
    var deselected: Set<String> = []

    // MARK: Access

    func refreshAuthorization() {
        let status = PhotoLibraryService.authorizationStatus()
        let changed = status != authorization
        authorization = status
        libraryToken += 1
        if changed || !albums.isEmpty {
            Task { await loadAlbums() }
        }
    }

    func requestAuthorization() async {
        authorization = await PhotoLibraryService.requestAuthorization()
    }

    // MARK: Source

    func loadAlbumsIfNeeded() async {
        if albums.isEmpty && !isLoadingAlbums {
            await loadAlbums()
        }
    }

    func loadAlbums() async {
        guard case .granted = access else { return }
        isLoadingAlbums = true
        let loaded = await Task.detached(priority: .userInitiated) {
            PhotoLibraryService.fetchAlbums()
        }.value
        albums = loaded
        isLoadingAlbums = false
        if selectedAlbumID == nil || !loaded.contains(where: { $0.id == selectedAlbumID }) {
            selectedAlbumID = loaded.first(where: \.isLibrary)?.id ?? loaded.first?.id
        }
    }

    func refreshAssets() async {
        guard case .granted = access else { return }
        let query = sourceQuery
        isCounting = true
        let list = await Task.detached(priority: .userInitiated) {
            PhotoLibraryService.fetchAssets(for: query)
        }.value
        guard !Task.isCancelled else { return }
        foundAssets = list.assets
        isCounting = false
    }

    // MARK: Analysis

    func findBestPhotos() {
        guard canAnalyze else { return }
        analysisTask?.cancel()

        let assets = foundAssets
        let ids = assets.map(\.localIdentifier)
        assetsByID = Dictionary(zip(ids, assets), uniquingKeysWith: { first, _ in first })
        suggestedAlbumTitle = makeSuggestedTitle()
        result = nil
        resultPlan = nil
        deselected = []

        let pending = assets
            .filter { cache[$0.localIdentifier] == nil }
            .map { AssetRef(asset: $0) }

        if pending.isEmpty {
            finishRun(ids: ids, failed: 0)
            return
        }

        let currentRun = UUID()
        runID = currentRun
        progress = AnalysisProgress(completed: 0, total: pending.count, failed: 0)
        isAnalyzing = true
        path = [.analysis]

        let analyzer = self.analyzer
        analysisTask = Task {
            let outcome = await analyzer.analyze(pending, maxConcurrent: 4) { completed, failed in
                guard self.runID == currentRun else { return }
                self.progress.completed = completed
                self.progress.failed = failed
            }

            // Keep partial work even when cancelled so the next run is faster.
            for (id, photo) in outcome.results {
                self.cache[id] = photo
            }
            guard self.runID == currentRun else { return }
            self.isAnalyzing = false
            self.analysisTask = nil
            guard !Task.isCancelled else { return }
            self.finishRun(ids: ids, failed: outcome.failedIDs.count)
        }
    }

    func cancelAnalysis() {
        analysisTask?.cancel()
        analysisTask = nil
        runID = UUID()
        isAnalyzing = false
        path.removeAll()
    }

    private func finishRun(ids: [String], failed: Int) {
        failedCount = failed
        analyzedIDs = ids.filter { cache[$0] != nil }
        updateSelection()
        path = [.results]
    }

    /// Re-runs selection on cached metrics. Re-clusters only if the photos or threshold changed.
    func updateSelection() {
        let plan = settings.plan
        guard PhotoSelector.validate(plan).isEmpty else { return }

        if plan.avoidNearDuplicates {
            updateClustersIfNeeded()
        }
        let candidates: [Candidate<String>] = analyzedIDs.compactMap { id -> Candidate<String>? in
            guard let photo = cache[id] else { return nil }
            return Candidate(
                id: id,
                metrics: photo.metrics,
                clusterID: plan.avoidNearDuplicates ? clusterIDs[id] : nil
            )
        }
        result = PhotoSelector.select(from: candidates, plan: plan)
        resultPlan = plan
        deselected = []
    }

    private func updateClustersIfNeeded() {
        let signature = ClusterSignature(ids: analyzedIDs, threshold: settings.similarityThreshold)
        guard signature != clusterSignature else { return }

        let ids = analyzedIDs
        let prints = ids.map { cache[$0]?.featurePrint }
        let clusters = SimilarityClusterer.cluster(
            count: ids.count,
            window: 15,
            threshold: signature.threshold
        ) { i, j in
            guard i >= 0, j >= 0, i < prints.count, j < prints.count else { return nil }
            return PhotoAnalyzer.distance(prints[i], prints[j])
        }

        var map: [String: Int] = [:]
        for (index, cluster) in clusters.enumerated() where index < ids.count {
            if let cluster {
                map[ids[index]] = cluster
            }
        }
        clusterIDs = map
        clusterSignature = signature
    }

    func startOver() {
        cancelAnalysis()
        result = nil
        resultPlan = nil
        deselected = []
    }

    // MARK: Results

    func metrics(for id: String) -> PhotoMetrics? {
        cache[id]?.metrics
    }

    var resultSections: [ResultSection] {
        guard let result, let plan = resultPlan else { return [] }

        var order: [SelectionCategory] = []
        for request in plan.requests where !order.contains(request.category) {
            order.append(request.category)
        }
        if !order.contains(.bestOverall), plan.fillRemainderWithBestOverall {
            order.append(.bestOverall)
        }
        for pick in result.picks where !order.contains(pick.category) {
            order.append(pick.category)
        }

        return order.compactMap { category -> ResultSection? in
            let picks = result.picks(for: category)
            // What the selector actually tried to fill: picks plus anything it came up short on.
            let requested = picks.count + max(0, result.shortfalls[category] ?? 0)
            guard !picks.isEmpty || requested > 0 else { return nil }
            return ResultSection(category: category, picks: picks, requested: requested)
        }
    }

    /// Picked photo identifiers the user hasn't deselected, in pick order, without duplicates.
    var keptIDs: [String] {
        guard let result else { return [] }
        var seen = Set<String>()
        return result.picks.compactMap { pick -> String? in
            guard !deselected.contains(pick.id), seen.insert(pick.id).inserted else { return nil }
            return pick.id
        }
    }

    func isKept(_ id: String) -> Bool {
        !deselected.contains(id)
    }

    func setKept(_ kept: Bool, id: String) {
        if kept {
            deselected.remove(id)
        } else {
            deselected.insert(id)
        }
    }

    // MARK: Export

    func saveKeptToNewAlbum(title: String) async throws -> Int {
        let ids = keptIDs
        guard !ids.isEmpty else { throw ExportError.nothingSelected }
        try await LibraryExporter.saveToNewAlbum(title: title, assetIDs: ids)
        return ids.count
    }

    func markKeptAsFavorites() async throws -> Int {
        let ids = keptIDs
        guard !ids.isEmpty else { throw ExportError.nothingSelected }
        try await LibraryExporter.markAsFavorites(assetIDs: ids)
        return ids.count
    }

    private func makeSuggestedTitle() -> String {
        switch sourceMode {
        case .album:
            if let album = selectedAlbum, !album.isLibrary {
                return "Best of \(album.title)"
            }
            return "Best of \(Date.now.formatted(date: .abbreviated, time: .omitted))"
        case .dateRange:
            return "Best of \(min(startDate, endDate).formatted(date: .abbreviated, time: .omitted))"
        case .handPicked:
            return "Best of \(Date.now.formatted(date: .abbreviated, time: .omitted))"
        }
    }

    // MARK: Defaults

    nonisolated private static func defaultStartDate() -> Date {
        Calendar.current.startOfDay(for: .now)
    }

    nonisolated private static func defaultEndDate() -> Date {
        let start = Calendar.current.startOfDay(for: .now)
        return Calendar.current.date(byAdding: DateComponents(day: 1, second: -1), to: start) ?? .now
    }
}

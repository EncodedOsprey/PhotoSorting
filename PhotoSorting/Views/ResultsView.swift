import Photos
import SwiftUI
import PhotoSortingCore

/// Picks grouped by category, with export actions.
struct ResultsView: View {
    @Environment(AppModel.self) private var model

    @State private var detail: DetailItem?
    @State private var showingCriteria = false
    @State private var showingStartOver = false
    @State private var showingSaveAlert = false
    @State private var albumTitle = ""
    @State private var isExporting = false
    @State private var feedback: ExportFeedback?
    @State private var showingFeedback = false

    private let columns = [GridItem(.adaptive(minimum: 100), spacing: 6)]

    var body: some View {
        let sections = model.resultSections

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if model.result != nil {
                    summaryHeader
                }
                ForEach(sections) { section in
                    sectionView(section)
                }
            }
            .padding()
        }
        .overlay {
            if model.result == nil {
                ContentUnavailableView(
                    "No Results",
                    systemImage: "photo.on.rectangle.angled",
                    description: Text("Run an analysis to see the best photos.")
                )
            }
        }
        .navigationTitle("Best Photos")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showingCriteria = true
                    } label: {
                        Label("Adjust Criteria", systemImage: "slider.horizontal.3")
                    }
                    Button(role: .destructive) {
                        showingStartOver = true
                    } label: {
                        Label("Start Over", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.result != nil {
                exportBar
            }
        }
        .sheet(item: $detail) { item in
            PhotoDetailView(pick: item.pick)
                .environment(model)
        }
        .sheet(isPresented: $showingCriteria) {
            AdjustCriteriaView()
                .environment(model)
        }
        .alert("Save to New Album", isPresented: $showingSaveAlert) {
            TextField("Album name", text: $albumTitle)
            Button("Save") {
                saveToAlbum()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Creates an album with the \(model.keptIDs.count) selected photos.")
        }
        .confirmationDialog("Start over?", isPresented: $showingStartOver, titleVisibility: .visible) {
            Button("Start Over", role: .destructive) {
                model.startOver()
            }
        } message: {
            Text("Your current selection will be cleared. Analysis results are kept, so the next run is faster.")
        }
        .alert(feedback?.title ?? "", isPresented: $showingFeedback, presenting: feedback) { _ in
            Button("OK", role: .cancel) {}
        } message: { feedback in
            Text(feedback.message)
        }
    }

    // MARK: Header

    private var summaryHeader: some View {
        let kept = model.keptIDs.count
        let removed = model.deselected.count

        return VStack(alignment: .leading, spacing: 6) {
            Text("\(kept) photos selected from \(model.analyzedIDs.count)")
                .font(.title2.bold())
            if removed > 0 {
                Text("\(removed) removed by you. Tap a photo to change.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text("Tap a photo for details, or long-press to remove it.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if model.failedCount > 0 {
                Label("\(model.failedCount) photos couldn't be loaded and were skipped.", systemImage: "exclamationmark.icloud")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
    }

    // MARK: Sections

    private func sectionView(_ section: ResultSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label(section.category.displayName, systemImage: section.category.systemImage)
                    .font(.headline)
                Spacer()
                Text(countText(for: section))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            if section.shortfall > 0 {
                Label(
                    "Only found \(section.picks.count) of \(section.requested) — \(section.category.shortfallReason)",
                    systemImage: "info.circle"
                )
                .font(.footnote)
                .foregroundStyle(.orange)
            }

            if !section.picks.isEmpty {
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(section.picks, id: \.id) { pick in
                        tile(for: pick)
                    }
                }
            }
        }
    }

    private func countText(for section: ResultSection) -> String {
        section.requested > 0 ? "\(section.picks.count) of \(section.requested)" : "\(section.picks.count)"
    }

    @ViewBuilder
    private func tile(for pick: Pick<String>) -> some View {
        if let asset = model.assetsByID[pick.id] {
            let kept = model.isKept(pick.id)
            Button {
                detail = DetailItem(pick: pick)
            } label: {
                AssetThumbnail(asset: asset)
                    .overlay(alignment: .topTrailing) {
                        ScoreBadge(score: pick.score)
                            .padding(4)
                    }
                    .overlay {
                        if !kept {
                            ZStack {
                                Color.black.opacity(0.55)
                                Image(systemName: "xmark.circle.fill")
                                    .font(.title2)
                                    .foregroundStyle(.white)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
            }
            .buttonStyle(.plain)
            .contextMenu {
                if kept {
                    Button(role: .destructive) {
                        model.setKept(false, id: pick.id)
                    } label: {
                        Label("Remove from Selection", systemImage: "minus.circle")
                    }
                } else {
                    Button {
                        model.setKept(true, id: pick.id)
                    } label: {
                        Label("Keep in Selection", systemImage: "plus.circle")
                    }
                }
            }
            .accessibilityLabel(Text("\(pick.category.displayName) photo, score \(Int((pick.score * 100).rounded())) percent"))
            .accessibilityValue(kept ? Text("Selected") : Text("Removed"))
        }
    }

    // MARK: Export

    private var exportBar: some View {
        HStack(spacing: 12) {
            Button {
                albumTitle = model.suggestedAlbumTitle
                showingSaveAlert = true
            } label: {
                Label("Save to Album", systemImage: "rectangle.stack.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button {
                markFavorites()
            } label: {
                Label("Favorite", systemImage: "heart")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .controlSize(.large)
        .disabled(isExporting || model.keptIDs.isEmpty)
        .overlay {
            if isExporting {
                ProgressView()
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func saveToAlbum() {
        let title = albumTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        isExporting = true
        Task {
            do {
                let count = try await model.saveKeptToNewAlbum(title: title)
                show(ExportFeedback(title: "Album Created", message: "Saved \(count) photos to “\(title.isEmpty ? "PhotoSorting Picks" : title)”."))
            } catch {
                show(ExportFeedback(title: "Couldn't Create Album", message: error.localizedDescription))
            }
            isExporting = false
        }
    }

    private func markFavorites() {
        isExporting = true
        Task {
            do {
                let count = try await model.markKeptAsFavorites()
                show(ExportFeedback(title: "Marked as Favorites", message: "\(count) photos were added to Favorites."))
            } catch {
                show(ExportFeedback(title: "Couldn't Mark Favorites", message: error.localizedDescription))
            }
            isExporting = false
        }
    }

    private func show(_ newFeedback: ExportFeedback) {
        feedback = newFeedback
        showingFeedback = true
    }
}

private struct DetailItem: Identifiable {
    let pick: Pick<String>
    var id: String { pick.id }
}

private struct ExportFeedback {
    let title: String
    let message: String
}

private struct ScoreBadge: View {
    let score: Double

    var body: some View {
        Text("\(Int((min(1, max(0, score)) * 100).rounded()))")
            .font(.caption2.weight(.bold))
            .monospacedDigit()
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(.ultraThinMaterial, in: Capsule())
    }
}

/// Edit the plan after analysis and re-run selection instantly from cached metrics.
private struct AdjustCriteriaView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                CriteriaSection()
            }
            .navigationTitle("Adjust Selection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Update Selection") {
                        model.updateSelection()
                        dismiss()
                    }
                    .disabled(!model.planIssues.isEmpty)
                }
            }
        }
    }
}

extension SelectionCategory {
    /// Why a category might come up short, for the results screen.
    var shortfallReason: String {
        switch self {
        case .bestSmiles: return "not enough photos with smiling faces"
        case .eyesOpen: return "not enough photos with faces and open eyes"
        case .sharpest: return "not enough sharp photos"
        case .wellExposed: return "not enough well-exposed photos"
        case .groupShots: return "not enough photos with three or more people"
        case .portraits: return "not enough close-up photos of one or two people"
        case .noPeople: return "not enough photos without people"
        case .bestOverall: return "not enough photos left after the other categories"
        }
    }
}

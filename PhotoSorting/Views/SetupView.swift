import SwiftUI
import UIKit

/// Root screen: where the shoot is, what to pick, and the "Find Best Photos" button.
struct SetupView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            if model.access == .granted(limited: true) {
                LimitedAccessSection()
            }
            SourceSection()
            CriteriaSection()
        }
        .navigationTitle("PhotoSorting")
        .safeAreaInset(edge: .bottom) {
            findButton
        }
        .task {
            await model.loadAlbumsIfNeeded()
        }
        .task(id: model.sourceQuery) {
            await model.refreshAssets()
        }
    }

    private var findButton: some View {
        VStack(spacing: 6) {
            Button {
                model.findBestPhotos()
            } label: {
                Label("Find Best Photos", systemImage: "sparkles")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!model.canAnalyze)

            if let reason = model.analyzeBlockedReason {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

private struct LimitedAccessSection: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            Label {
                Text("PhotoSorting can only see the photos you've shared with it. Photos outside that selection won't be found.")
                    .font(.subheadline)
            } icon: {
                Image(systemName: "exclamationmark.lock")
                    .foregroundStyle(.orange)
            }
            Button("Change Access in Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            }
        } header: {
            Text("Limited Access")
        }
    }
}

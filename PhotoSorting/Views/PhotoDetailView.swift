import Photos
import SwiftUI
import UIKit
import PhotoSortingCore

/// Larger preview of a pick with its metric breakdown and a "Keep in selection" toggle.
struct PhotoDetailView: View {
    let pick: Pick<String>

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var keep = true

    var body: some View {
        let asset = model.assetsByID[pick.id]
        let metrics = model.metrics(for: pick.id)

        NavigationStack {
            List {
                Section {
                    photoView(for: asset)
                        .listRowInsets(EdgeInsets())
                }

                Section {
                    Toggle(isOn: $keep) {
                        Label("Keep in selection", systemImage: "checkmark.circle")
                    }
                }

                Section("Picked For") {
                    Label(pick.category.displayName, systemImage: pick.category.systemImage)
                    MetricRow(title: "Category score", systemImage: "chart.bar", value: pick.score)
                }

                if let metrics {
                    analysisSection(metrics)
                }
            }
            .navigationTitle(title(for: asset))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            keep = model.isKept(pick.id)
        }
        .onChange(of: keep) { _, newValue in
            model.setKept(newValue, id: pick.id)
        }
        .task(id: pick.id) {
            guard let asset else { return }
            let loaded = await ImageLoader.image(
                for: asset,
                targetSize: CGSize(width: 1500, height: 1500),
                contentMode: .aspectFit,
                deliveryMode: .highQualityFormat,
                manager: ImageLoader.displayManager
            )
            if let loaded {
                image = loaded
            }
        }
    }

    @ViewBuilder
    private func photoView(for asset: PHAsset?) -> some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
        } else {
            Color(uiColor: .secondarySystemBackground)
                .aspectRatio(aspectRatio(of: asset), contentMode: .fit)
                .frame(maxWidth: .infinity)
                .overlay {
                    ProgressView()
                }
        }
    }

    @ViewBuilder
    private func analysisSection(_ metrics: PhotoMetrics) -> some View {
        Section("Analysis") {
            LabeledContent {
                Text(metrics.faceCount, format: .number)
                    .monospacedDigit()
            } label: {
                Label("Faces", systemImage: "person.2")
            }

            if !metrics.faces.isEmpty {
                MetricRow(title: "Smile", systemImage: "face.smiling", value: averageSmile(metrics))
                MetricRow(title: "Eyes open (lowest face)", systemImage: "eye", value: lowestEyesOpen(metrics))
                if let quality = averageCaptureQuality(metrics) {
                    MetricRow(title: "Face quality", systemImage: "person.crop.circle.badge.checkmark", value: quality)
                }
            }

            MetricRow(title: "Sharpness", systemImage: "camera.aperture", value: metrics.sharpness)
            MetricRow(title: "Exposure", systemImage: "sun.max", value: metrics.exposure)

            if let aesthetics = metrics.aesthetics {
                MetricRow(title: "Aesthetics", systemImage: "wand.and.stars", value: aesthetics)
            }

            MetricRow(title: "Overall", systemImage: "star", value: Scorer.overall(metrics))

            if metrics.isUtility {
                Label("Looks like a utility photo (screenshot, receipt or document).", systemImage: "doc.text.viewfinder")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func title(for asset: PHAsset?) -> String {
        asset?.creationDate?.formatted(date: .abbreviated, time: .shortened) ?? "Photo"
    }

    private func aspectRatio(of asset: PHAsset?) -> CGFloat {
        guard let asset, asset.pixelWidth > 0, asset.pixelHeight > 0 else { return 1 }
        return CGFloat(asset.pixelWidth) / CGFloat(asset.pixelHeight)
    }

    private func averageSmile(_ metrics: PhotoMetrics) -> Double {
        guard !metrics.faces.isEmpty else { return 0 }
        return metrics.faces.map(\.smile).reduce(0, +) / Double(metrics.faces.count)
    }

    private func lowestEyesOpen(_ metrics: PhotoMetrics) -> Double {
        metrics.faces.map(\.eyesOpen).min() ?? 0
    }

    private func averageCaptureQuality(_ metrics: PhotoMetrics) -> Double? {
        let qualities = metrics.faces.compactMap(\.captureQuality)
        guard !qualities.isEmpty else { return nil }
        return qualities.reduce(0, +) / Double(qualities.count)
    }
}

private struct MetricRow: View {
    let title: String
    let systemImage: String
    let value: Double

    private var clamped: Double { min(1, max(0, value)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Text(clamped, format: .percent.precision(.fractionLength(0)))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: clamped)
                .tint(tint)
        }
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch clamped {
        case ..<0.35: return .red
        case ..<0.65: return .orange
        default: return .green
        }
    }
}

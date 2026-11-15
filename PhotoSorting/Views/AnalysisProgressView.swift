import SwiftUI
import UIKit

struct AnalysisProgressView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let progress = model.progress

        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 60))
                .foregroundStyle(.tint)
                .symbolEffect(.pulse, options: .repeating, isActive: model.isAnalyzing)

            VStack(spacing: 8) {
                Text("Analyzing Photos")
                    .font(.title2.bold())
                Text("Checking faces, smiles, eyes, focus and exposure on your iPhone.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 8) {
                ProgressView(value: progress.fraction)
                    .progressViewStyle(.linear)
                Text("\(progress.completed) of \(progress.total)")
                    .font(.headline)
                    .monospacedDigit()
                if progress.failed > 0 {
                    Label("\(progress.failed) couldn't be loaded and will be skipped", systemImage: "exclamationmark.icloud")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            }

            Spacer()

            Button(role: .cancel) {
                model.cancelAnalysis()
            } label: {
                Text("Cancel")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
        .padding(24)
        .navigationTitle("Analyzing")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }
}

import SwiftUI
import UIKit

/// Shown before access is granted, or when it has been denied.
struct PermissionView: View {
    let isDenied: Bool

    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var isRequesting = false

    private var title: String {
        isDenied ? "Photo Access Is Off" : "Find the Best Shots"
    }

    private var message: String {
        if isDenied {
            return "PhotoSorting needs access to your photo library to find and analyze the photos from your shoot. You can turn it on in Settings — choosing \"Limited Access\" works too."
        }
        return "PhotoSorting looks through the photos from your shoot and picks the best smiles, open eyes and sharpest frames. Everything is analyzed on your iPhone; nothing is uploaded."
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: isDenied ? "lock.rectangle.stack" : "photo.stack")
                    .font(.system(size: 64))
                    .foregroundStyle(.tint)
                    .padding(.top, 60)

                Text(title)
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)

                Text(message)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if isDenied {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    } label: {
                        Label("Open Settings", systemImage: "gear")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                } else {
                    Button {
                        isRequesting = true
                        Task {
                            await model.requestAuthorization()
                            isRequesting = false
                        }
                    } label: {
                        Label("Allow Photo Access", systemImage: "photo.badge.checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(isRequesting)
                }
            }
            .padding(24)
        }
    }
}

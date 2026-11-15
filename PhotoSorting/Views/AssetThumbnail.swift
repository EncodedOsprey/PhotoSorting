import Photos
import SwiftUI
import UIKit

/// Square, aspect-filled thumbnail for a PHAsset.
struct AssetThumbnail: View {
    let asset: PHAsset
    var pixelSize: CGFloat = 300

    @State private var image: UIImage?

    var body: some View {
        Color(uiColor: .secondarySystemBackground)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(.tertiary)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .task(id: asset.localIdentifier) {
                let loaded = await ImageLoader.image(
                    for: asset,
                    targetSize: CGSize(width: pixelSize, height: pixelSize),
                    contentMode: .aspectFill,
                    deliveryMode: .opportunistic,
                    manager: ImageLoader.displayManager
                )
                if let loaded {
                    image = loaded
                }
            }
    }
}

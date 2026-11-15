import Foundation
import Photos

enum ExportError: LocalizedError {
    case nothingSelected
    case assetsUnavailable

    var errorDescription: String? {
        switch self {
        case .nothingSelected: return "No photos are selected."
        case .assetsUnavailable: return "The selected photos are no longer available in your library."
        }
    }
}

/// Writes the selection back to the Photos library.
enum LibraryExporter {
    /// Creates a new album titled `title` containing the assets, in the given order.
    static func saveToNewAlbum(title: String, assetIDs: [String]) async throws {
        let assets = orderedAssets(for: assetIDs)
        guard !assets.isEmpty else { throw ExportError.assetsUnavailable }
        let albumTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let assetArray = assets as NSArray

        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(
                withTitle: albumTitle.isEmpty ? "PhotoSorting Picks" : albumTitle
            )
            request.addAssets(assetArray)
        }
    }

    /// Marks every asset as a favorite.
    static func markAsFavorites(assetIDs: [String]) async throws {
        let assets = orderedAssets(for: assetIDs)
        guard !assets.isEmpty else { throw ExportError.assetsUnavailable }

        try await PHPhotoLibrary.shared().performChanges {
            for asset in assets {
                let request = PHAssetChangeRequest(for: asset)
                request.isFavorite = true
            }
        }
    }

    private static func orderedAssets(for ids: [String]) -> [PHAsset] {
        guard !ids.isEmpty else { return [] }
        let result = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var byID: [String: PHAsset] = [:]
        for index in 0..<result.count {
            let asset = result.object(at: index)
            byID[asset.localIdentifier] = asset
        }
        return ids.compactMap { byID[$0] }
    }
}

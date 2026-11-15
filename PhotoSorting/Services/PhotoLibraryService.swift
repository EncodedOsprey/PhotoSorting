import Foundation
import Photos

/// Non-Sendable PhotoKit objects wrapped so they can cross concurrency boundaries.
/// PHAsset is immutable and safe to read from any thread.
struct AssetList: @unchecked Sendable {
    let assets: [PHAsset]
}

struct AssetRef: @unchecked Sendable {
    let asset: PHAsset
    var id: String { asset.localIdentifier }
}

/// Read-only queries against the user's Photos library.
enum PhotoLibraryService {
    static func authorizationStatus() -> PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    static func requestAuthorization() async -> PHAuthorizationStatus {
        await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    // MARK: Albums

    private static let smartAlbums: [(subtype: PHAssetCollectionSubtype, systemImage: String)] = [
        (.smartAlbumUserLibrary, "photo.on.rectangle"),
        (.smartAlbumFavorites, "heart"),
        (.smartAlbumRecentlyAdded, "clock"),
        (.smartAlbumDepthEffect, "cube"),
        (.smartAlbumSelfPortraits, "person.crop.square"),
        (.smartAlbumBursts, "square.stack.3d.down.right"),
        (.smartAlbumLivePhotos, "livephoto")
    ]

    static func fetchAlbums() -> [AlbumInfo] {
        var albums: [AlbumInfo] = []

        for entry in smartAlbums {
            let collections = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: entry.subtype, options: nil)
            for index in 0..<collections.count {
                let collection = collections.object(at: index)
                let count = imageCount(in: collection)
                guard count > 0 || entry.subtype == .smartAlbumUserLibrary else { continue }
                albums.append(AlbumInfo(
                    id: collection.localIdentifier,
                    title: collection.localizedTitle ?? "Untitled",
                    count: count,
                    kind: .smart,
                    systemImage: entry.systemImage,
                    isLibrary: entry.subtype == .smartAlbumUserLibrary
                ))
            }
        }

        var userAlbums: [AlbumInfo] = []
        let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
        for index in 0..<collections.count {
            let collection = collections.object(at: index)
            // Shared-album photos aren't in the user's library, so they can't be favorited or added to a new album.
            guard collection.assetCollectionSubtype != .albumCloudShared else { continue }
            let count = imageCount(in: collection)
            guard count > 0 else { continue }
            userAlbums.append(AlbumInfo(
                id: collection.localIdentifier,
                title: collection.localizedTitle ?? "Untitled",
                count: count,
                kind: .user,
                systemImage: "rectangle.stack",
                isLibrary: false
            ))
        }
        userAlbums.sort { $0.title.localizedStandardCompare($1.title) == .orderedAscending }

        return albums + userAlbums
    }

    private static func imageCount(in collection: PHAssetCollection) -> Int {
        let options = PHFetchOptions()
        options.predicate = imagePredicate
        options.includeAllBurstAssets = collection.assetCollectionSubtype == .smartAlbumBursts
        return PHAsset.fetchAssets(in: collection, options: options).count
    }

    // MARK: Assets

    private static var imagePredicate: NSPredicate {
        NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    }

    /// Images matching the query, sorted by creation date (oldest first).
    static func fetchAssets(for query: SourceQuery) -> AssetList {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        options.predicate = imagePredicate

        let fetchResult: PHFetchResult<PHAsset>
        switch query.mode {
        case .album:
            guard
                let albumID = query.albumID,
                let collection = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID], options: nil).firstObject
            else {
                return AssetList(assets: [])
            }
            options.includeAllBurstAssets = collection.assetCollectionSubtype == .smartAlbumBursts
            fetchResult = PHAsset.fetchAssets(in: collection, options: options)

        case .dateRange:
            let lower = min(query.startDate, query.endDate)
            let upper = max(query.startDate, query.endDate)
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                imagePredicate,
                NSPredicate(format: "creationDate >= %@ AND creationDate <= %@", lower as NSDate, upper as NSDate)
            ])
            fetchResult = PHAsset.fetchAssets(with: options)

        case .handPicked:
            guard !query.pickedIDs.isEmpty else { return AssetList(assets: []) }
            fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: query.pickedIDs, options: options)
        }

        guard fetchResult.count > 0 else { return AssetList(assets: []) }
        var assets = fetchResult.objects(at: IndexSet(integersIn: 0..<fetchResult.count))

        if query.favoritesOnly {
            assets = assets.filter(\.isFavorite)
        }
        if query.excludeScreenshots {
            assets = assets.filter { !$0.mediaSubtypes.contains(.photoScreenshot) }
        }
        if query.mode == .handPicked {
            // Identifier fetches don't guarantee ordering; keep it chronological for near-duplicate detection.
            assets.sort { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }
        }
        return AssetList(assets: assets)
    }
}

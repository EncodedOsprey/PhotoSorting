import Foundation

/// How the photographer finds the shoot in their library.
enum SourceMode: String, CaseIterable, Identifiable, Hashable, Sendable {
    case album
    case dateRange
    case handPicked

    var id: String { rawValue }

    var title: String {
        switch self {
        case .album: return "Album"
        case .dateRange: return "Dates"
        case .handPicked: return "Hand-pick"
        }
    }

    var footer: String {
        switch self {
        case .album:
            return "Choose an album or smart album such as Recents, Favorites or Portrait."
        case .dateRange:
            return "Finds every photo taken between the start and end of the shoot."
        case .handPicked:
            return "Use the Photos search (people, places, things, dates) to pick the shoot yourself."
        }
    }
}

/// An album row in the album picker.
struct AlbumInfo: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable {
        case smart
        case user
    }

    /// `PHAssetCollection.localIdentifier`.
    let id: String
    let title: String
    let count: Int
    let kind: Kind
    let systemImage: String
    /// True for the "Recents" (user library) smart album, the default source.
    let isLibrary: Bool
}

/// Everything that determines which assets are "found". Used as a `.task(id:)` key.
struct SourceQuery: Hashable, Sendable {
    var mode: SourceMode
    var albumID: String?
    var startDate: Date
    var endDate: Date
    var pickedIDs: [String]
    var favoritesOnly: Bool
    var excludeScreenshots: Bool
    /// Bumped when the library may have changed (e.g. returning from Settings).
    var libraryToken: Int
}

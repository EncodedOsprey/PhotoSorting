import SwiftUI

/// Searchable list of smart albums and user albums with image counts.
struct AlbumPickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""

    var body: some View {
        let smart = filtered(model.albums.filter { $0.kind == .smart })
        let user = filtered(model.albums.filter { $0.kind == .user })

        List {
            albumSection("Library", albums: smart)
            albumSection("My Albums", albums: user)
        }
        .overlay {
            if model.albums.isEmpty && model.isLoadingAlbums {
                ProgressView("Loading Albums…")
            } else if smart.isEmpty && user.isEmpty {
                if searchText.isEmpty {
                    ContentUnavailableView(
                        "No Albums",
                        systemImage: "rectangle.stack",
                        description: Text("Albums with photos will appear here.")
                    )
                } else {
                    ContentUnavailableView.search(text: searchText)
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search albums")
        .navigationTitle("Albums")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await model.loadAlbums()
        }
        .task {
            await model.loadAlbums()
        }
    }

    @ViewBuilder
    private func albumSection(_ title: String, albums: [AlbumInfo]) -> some View {
        if !albums.isEmpty {
            Section(title) {
                ForEach(albums) { album in
                    Button {
                        model.selectedAlbumID = album.id
                        dismiss()
                    } label: {
                        HStack {
                            Label(album.title, systemImage: album.systemImage)
                                .foregroundStyle(.primary)
                            Spacer()
                            Text(album.count, format: .number)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                            if album.id == model.selectedAlbumID {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                                    .fontWeight(.semibold)
                            }
                        }
                    }
                }
            }
        }
    }

    private func filtered(_ albums: [AlbumInfo]) -> [AlbumInfo] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return albums }
        return albums.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }
}

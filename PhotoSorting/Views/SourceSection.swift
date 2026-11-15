import PhotosUI
import SwiftUI

/// "Find the Shoot": album, date range or hand-picked photos, plus filters and a live count.
struct SourceSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        Section {
            Picker("Source", selection: $model.sourceMode) {
                ForEach(SourceMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)

            switch model.sourceMode {
            case .album:
                NavigationLink(value: Route.albumPicker) {
                    LabeledContent {
                        if let album = model.selectedAlbum {
                            Text(album.title)
                        } else if model.isLoadingAlbums {
                            ProgressView()
                        } else {
                            Text("Choose…")
                        }
                    } label: {
                        Label("Album", systemImage: model.selectedAlbum?.systemImage ?? "rectangle.stack")
                    }
                }

            case .dateRange:
                DatePicker(selection: $model.startDate) {
                    Label("Shoot start", systemImage: "calendar")
                }
                DatePicker(selection: $model.endDate, in: model.startDate...) {
                    Label("Shoot end", systemImage: "calendar.badge.clock")
                }

            case .handPicked:
                PhotosPicker(
                    selection: $model.pickerItems,
                    maxSelectionCount: nil,
                    selectionBehavior: .ordered,
                    matching: .images,
                    photoLibrary: .shared()
                ) {
                    Label(pickerTitle, systemImage: "photo.badge.plus")
                }
                if !model.pickerItems.isEmpty {
                    Button("Clear Chosen Photos", role: .destructive) {
                        model.pickerItems = []
                    }
                }
            }

            Toggle(isOn: $model.favoritesOnly) {
                Label("Favorites only", systemImage: "heart")
            }
            Toggle(isOn: $model.excludeScreenshots) {
                Label("Exclude screenshots", systemImage: "camera.viewfinder")
            }

            HStack {
                Label {
                    Text(foundText)
                        .monospacedDigit()
                } icon: {
                    Image(systemName: "photo.stack")
                }
                .font(.headline)
                Spacer()
                if model.isCounting {
                    ProgressView()
                }
            }
        } header: {
            Text("Find the Shoot")
        } footer: {
            Text(model.sourceMode.footer)
        }
    }

    private var pickerTitle: String {
        model.pickerItems.isEmpty
            ? "Search & Choose Photos…"
            : "Edit Chosen Photos (\(model.pickerItems.count))"
    }

    private var foundText: String {
        let count = model.foundAssets.count
        return count == 1 ? "1 photo found" : "\(count) photos found"
    }
}

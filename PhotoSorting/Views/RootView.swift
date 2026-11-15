import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model

        Group {
            switch model.access {
            case .granted:
                NavigationStack(path: $model.path) {
                    SetupView()
                        .navigationDestination(for: Route.self) { route in
                            switch route {
                            case .albumPicker:
                                AlbumPickerView()
                            case .analysis:
                                AnalysisProgressView()
                            case .results:
                                ResultsView()
                            }
                        }
                }
            case .notDetermined:
                PermissionView(isDenied: false)
            case .denied:
                PermissionView(isDenied: true)
            }
        }
        .onChange(of: model.settings) { _, newValue in
            newValue.save()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.refreshAuthorization()
            }
        }
    }
}

import SwiftUI
import PhotoSortingCore

/// Total count, per-category quotas in priority order, and selection options.
struct CriteriaSection: View {
    @Environment(AppModel.self) private var model
    @FocusState private var totalFieldFocused: Bool

    var body: some View {
        @Bindable var model = model

        Section {
            HStack {
                Label("Total photos", systemImage: "number")
                Spacer()
                TextField("Total", value: $model.settings.totalCount, format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .focused($totalFieldFocused)
                    .frame(maxWidth: 64)
                Stepper("Total photos", value: $model.settings.totalCount, in: PlanSettings.totalRange)
                    .labelsHidden()
            }
        } header: {
            Text("How Many Photos")
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    totalFieldFocused = false
                }
            }
        }
        .onChange(of: model.settings.totalCount) { _, newValue in
            let clamped = min(max(newValue, PlanSettings.totalRange.lowerBound), PlanSettings.totalRange.upperBound)
            if clamped != newValue {
                model.settings.totalCount = clamped
            }
        }

        Section {
            ForEach($model.settings.categories) { $setting in
                CategoryRow(setting: $setting)
            }
            .onMove { offsets, destination in
                model.settings.categories.move(fromOffsets: offsets, toOffset: destination)
            }
        } header: {
            HStack {
                Text("Categories by Priority")
                Spacer()
                EditButton()
                    .font(.footnote)
                    .textCase(nil)
            }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(assignmentSummary)
                Text("Categories higher in the list get first pick. Tap Edit to reorder.")
                ForEach(model.planIssues, id: \.self) { issue in
                    Label(issue.message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
        }

        Section {
            Toggle(isOn: $model.settings.fillRemainderWithBestOverall) {
                Label("Fill remainder with Best Overall", systemImage: SelectionCategory.bestOverall.systemImage)
            }
            Toggle(isOn: $model.settings.avoidNearDuplicates) {
                Label("Avoid near-duplicates", systemImage: "square.on.square")
            }
            if model.settings.avoidNearDuplicates {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Duplicate sensitivity")
                        .font(.subheadline)
                    Slider(
                        value: $model.settings.similarityThreshold,
                        in: PlanSettings.similarityRange,
                        step: 0.05
                    ) {
                        Text("Duplicate sensitivity")
                    } minimumValueLabel: {
                        Text("Strict").font(.caption)
                    } maximumValueLabel: {
                        Text("Loose").font(.caption)
                    }
                }
            }
            Toggle(isOn: $model.settings.excludeBlurry) {
                Label("Exclude blurry photos", systemImage: "camera.metering.unknown")
            }
            Toggle(isOn: $model.settings.excludeClosedEyes) {
                Label("Exclude closed eyes", systemImage: "eye.slash")
            }
        } header: {
            Text("Options")
        } footer: {
            Text("Near-duplicates are frames of the same moment; only the best one is kept. Strict groups only nearly identical frames, Loose also groups similar shots.")
        }
    }

    private var assignmentSummary: String {
        let plan = model.settings.plan
        let assigned = plan.requestedCount
        let remainder = max(0, plan.totalCount - assigned)
        if plan.fillRemainderWithBestOverall {
            return "\(assigned) of \(plan.totalCount) assigned, \(remainder) filled with Best Overall."
        }
        return "\(assigned) of \(plan.totalCount) assigned, \(remainder) left unfilled."
    }
}

private struct CategoryRow: View {
    @Binding var setting: CategorySetting

    var body: some View {
        let category = setting.category
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: $setting.isEnabled) {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(category.displayName)
                        Text(category.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: category.systemImage)
                        .foregroundStyle(.tint)
                }
            }
            if setting.isEnabled {
                Stepper(value: $setting.count, in: PlanSettings.countRange) {
                    Text(countLabel)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var countLabel: String {
        setting.count == 1 ? "1 photo" : "\(setting.count) photos"
    }
}

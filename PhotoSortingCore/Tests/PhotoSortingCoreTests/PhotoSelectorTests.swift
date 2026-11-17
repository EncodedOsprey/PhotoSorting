import XCTest
@testable import PhotoSortingCore

final class PhotoSelectorTests: XCTestCase {
    private func face(smile: Double = 0.8, eyes: Double = 0.9, area: Double = 0.05) -> FaceMetrics {
        FaceMetrics(smile: smile, eyesOpen: eyes, captureQuality: nil, areaFraction: area)
    }

    private func photo(_ id: Int, faces: [FaceMetrics] = [], sharp: Double = 0.7, exposure: Double = 0.7, cluster: Int? = nil) -> Candidate<Int> {
        Candidate(id: id, metrics: PhotoMetrics(faces: faces, sharpness: sharp, exposure: exposure), clusterID: cluster)
    }

    // MARK: validate

    func testValidPlanHasNoIssues() {
        let plan = SelectionPlan(totalCount: 5, requests: [.init(category: .sharpest, count: 2), .init(category: .bestSmiles, count: 3)])
        XCTAssertEqual(PhotoSelector.validate(plan), [])
    }

    func testValidationIssues() {
        XCTAssertTrue(PhotoSelector.validate(SelectionPlan(totalCount: 0, requests: [])).contains(.totalMustBePositive))
        let plan = SelectionPlan(totalCount: 3, requests: [
            .init(category: .sharpest, count: -1),
            .init(category: .bestSmiles, count: 2),
            .init(category: .bestSmiles, count: 2),
        ])
        let issues = PhotoSelector.validate(plan)
        XCTAssertTrue(issues.contains(.negativeCount(.sharpest)))
        XCTAssertTrue(issues.contains(.duplicateCategory(.bestSmiles)))
        XCTAssertTrue(issues.contains(.quotasExceedTotal(requested: 4, total: 3)))
    }

    // MARK: select

    func testRespectsCountsTotalAndNoDoublePicks() {
        let candidates = (0..<20).map { photo($0, faces: $0 % 2 == 0 ? [face()] : [], sharp: 0.3 + Double($0) * 0.03) }
        let plan = SelectionPlan(totalCount: 8, requests: [
            .init(category: .sharpest, count: 3),
            .init(category: .noPeople, count: 2),
        ])
        let result = PhotoSelector.select(from: candidates, plan: plan)
        XCTAssertEqual(result.picks.count, 8)
        XCTAssertEqual(result.picks(for: .sharpest).count, 3)
        XCTAssertEqual(result.picks(for: .noPeople).count, 2)
        XCTAssertEqual(result.picks(for: .bestOverall).count, 3)
        XCTAssertEqual(Set(result.picks.map(\.id)).count, 8)
        XCTAssertTrue(result.shortfalls.isEmpty)
        XCTAssertEqual(result.picks(for: .sharpest).map(\.id), [19, 18, 17])
    }

    func testEarlierRequestsGetPriority() {
        let candidates = [photo(0, sharp: 0.9), photo(1, sharp: 0.5)]
        let plan = SelectionPlan(totalCount: 2, requests: [
            .init(category: .noPeople, count: 1),
            .init(category: .sharpest, count: 1),
        ], fillRemainderWithBestOverall: false)
        let result = PhotoSelector.select(from: candidates, plan: plan)
        XCTAssertEqual(result.picks.map(\.id), [0, 1])
        XCTAssertEqual(result.picks.map(\.category), [.noPeople, .sharpest])
    }

    func testShortfallsAndRemainderFill() {
        let candidates = [photo(0), photo(1), photo(2, faces: [face()])]
        let plan = SelectionPlan(totalCount: 5, requests: [.init(category: .groupShots, count: 2)])
        let result = PhotoSelector.select(from: candidates, plan: plan)
        XCTAssertEqual(result.shortfalls[.groupShots], 2)
        XCTAssertEqual(result.picks(for: .bestOverall).count, 3)
        XCTAssertEqual(result.shortfalls[.bestOverall], 2)
    }

    func testFillDisabledLeavesRemainderEmpty() {
        let candidates = (0..<5).map { photo($0) }
        let plan = SelectionPlan(totalCount: 4, requests: [.init(category: .sharpest, count: 1)], fillRemainderWithBestOverall: false)
        XCTAssertEqual(PhotoSelector.select(from: candidates, plan: plan).picks.count, 1)
    }

    func testDedupeByCluster() {
        let candidates = [photo(0, sharp: 0.9, cluster: 1), photo(1, sharp: 0.8, cluster: 1), photo(2, sharp: 0.5)]
        let plan = SelectionPlan(totalCount: 2, requests: [.init(category: .sharpest, count: 2)])
        XCTAssertEqual(PhotoSelector.select(from: candidates, plan: plan).picks.map(\.id), [0, 2])

        var noDedupe = plan
        noDedupe.avoidNearDuplicates = false
        XCTAssertEqual(PhotoSelector.select(from: candidates, plan: noDedupe).picks.map(\.id), [0, 1])
    }

    func testDedupeAppliesAcrossCategories() {
        let candidates = [photo(0, sharp: 0.9, cluster: 3), photo(1, sharp: 0.8, cluster: 3)]
        let plan = SelectionPlan(totalCount: 2, requests: [.init(category: .sharpest, count: 1)])
        let result = PhotoSelector.select(from: candidates, plan: plan)
        XCTAssertEqual(result.picks.map(\.id), [0])
        XCTAssertEqual(result.shortfalls[.bestOverall], 1)
    }

    func testHardFilters() {
        let candidates = [
            photo(0, sharp: 0.1),
            photo(1, faces: [face(eyes: 0.1)], sharp: 0.95),
            photo(2, faces: [face(eyes: 0.9)], sharp: 0.6),
            // Sunglasses: hidden eyes don't count as closed.
            photo(3, faces: [FaceMetrics(smile: 0.8, eyesOpen: 0.1, eyesVisible: false, areaFraction: 0.05)], sharp: 0.5),
        ]
        let plan = SelectionPlan(totalCount: 4, requests: [], excludeBlurry: true, excludeClosedEyes: true)
        let result = PhotoSelector.select(from: candidates, plan: plan)
        XCTAssertEqual(result.picks.map(\.id), [2, 3])

        let lenient = SelectionPlan(totalCount: 4, requests: [], excludeBlurry: false, excludeClosedEyes: false)
        XCTAssertEqual(PhotoSelector.select(from: candidates, plan: lenient).picks.count, 4)
    }

    func testInvalidPlanNeverExceedsTotal() {
        let candidates = (0..<10).map { photo($0) }
        let plan = SelectionPlan(totalCount: 3, requests: [
            .init(category: .sharpest, count: -2),
            .init(category: .wellExposed, count: 2),
            .init(category: .sharpest, count: 5),
        ])
        let result = PhotoSelector.select(from: candidates, plan: plan)
        XCTAssertEqual(result.picks.count, 3)
        XCTAssertEqual(result.picks(for: .wellExposed).count, 2)
        XCTAssertEqual(result.picks(for: .sharpest).count, 1)
        XCTAssertTrue(PhotoSelector.select(from: candidates, plan: SelectionPlan(totalCount: -1, requests: [])).picks.isEmpty)
    }
}

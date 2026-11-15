import XCTest
@testable import PhotoSortingCore

final class ScorerTests: XCTestCase {
    private func faces(_ n: Int, area: Double = 0.05) -> [FaceMetrics] {
        Array(repeating: FaceMetrics(smile: 0.8, eyesOpen: 0.9, captureQuality: 0.7, areaFraction: area), count: n)
    }

    func testEligibilityRules() {
        let none = PhotoMetrics(faces: [], sharpness: 0.8, exposure: 0.8)
        let two = PhotoMetrics(faces: faces(2), sharpness: 0.8, exposure: 0.8)
        let three = PhotoMetrics(faces: faces(3), sharpness: 0.8, exposure: 0.8)
        let tinyFace = PhotoMetrics(faces: faces(1, area: 0.005), sharpness: 0.8, exposure: 0.8)

        XCTAssertFalse(Scorer.isEligible(two, for: .groupShots))
        XCTAssertTrue(Scorer.isEligible(three, for: .groupShots))
        XCTAssertTrue(Scorer.isEligible(none, for: .noPeople))
        XCTAssertFalse(Scorer.isEligible(two, for: .noPeople))
        XCTAssertFalse(Scorer.isEligible(none, for: .bestSmiles))
        XCTAssertTrue(Scorer.isEligible(two, for: .portraits))
        XCTAssertFalse(Scorer.isEligible(three, for: .portraits))
        XCTAssertFalse(Scorer.isEligible(tinyFace, for: .portraits))

        var utility = none
        utility.isUtility = true
        for category in SelectionCategory.allCases {
            XCTAssertFalse(Scorer.isEligible(utility, for: category), "\(category)")
        }
    }

    func testOneNonSmilerHurtsBestSmiles() {
        let smiling = FaceMetrics(smile: 0.9, eyesOpen: 0.9, areaFraction: 0.05)
        let frowning = FaceMetrics(smile: 0.1, eyesOpen: 0.9, areaFraction: 0.05)
        let all = PhotoMetrics(faces: [smiling, smiling, smiling], sharpness: 0.7, exposure: 0.7)
        let oneOff = PhotoMetrics(faces: [smiling, smiling, frowning], sharpness: 0.7, exposure: 0.7)
        XCTAssertGreaterThan(Scorer.score(all, for: .bestSmiles), Scorer.score(oneOff, for: .bestSmiles) + 0.2)
    }

    func testScoresInRangeAndOverallMatches() {
        let m = PhotoMetrics(faces: faces(3), sharpness: 1.5, exposure: -0.2, aesthetics: 0.9)
        for category in SelectionCategory.allCases {
            let s = Scorer.score(m, for: category)
            XCTAssertTrue((0...1).contains(s), "\(category): \(s)")
        }
        XCTAssertEqual(Scorer.score(m, for: .bestOverall), Scorer.overall(m))
    }

    func testSharpestPrefersSharpness() {
        let sharp = PhotoMetrics(faces: [], sharpness: 0.9, exposure: 0.5)
        let soft = PhotoMetrics(faces: [], sharpness: 0.4, exposure: 0.9)
        XCTAssertGreaterThan(Scorer.score(sharp, for: .sharpest), Scorer.score(soft, for: .sharpest))
        XCTAssertGreaterThan(Scorer.score(soft, for: .wellExposed), Scorer.score(sharp, for: .wellExposed))
    }
}

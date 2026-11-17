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

    func testEyesOpenNeedsEveryFaceVisiblyOpen() {
        let open = FaceMetrics(smile: 0.8, eyesOpen: 0.9, areaFraction: 0.05)
        let halfClosed = FaceMetrics(smile: 0.8, eyesOpen: 0.45, areaFraction: 0.05)
        let sunglasses = FaceMetrics(smile: 0.8, eyesOpen: 0.9, eyesVisible: false, areaFraction: 0.05)
        XCTAssertTrue(Scorer.isEligible(PhotoMetrics(faces: [open, open], sharpness: 0.8, exposure: 0.8), for: .eyesOpen))
        XCTAssertFalse(Scorer.isEligible(PhotoMetrics(faces: [open, halfClosed], sharpness: 0.8, exposure: 0.8), for: .eyesOpen))
        XCTAssertFalse(Scorer.isEligible(PhotoMetrics(faces: [open, sunglasses], sharpness: 0.8, exposure: 0.8), for: .eyesOpen))
    }

    func testHiddenEyesAreLeftOutOfEyeScores() {
        let open = FaceMetrics(smile: 0.8, eyesOpen: 0.9, captureQuality: 0.7, areaFraction: 0.05)
        var sunglasses = open
        sunglasses.eyesOpen = 0
        sunglasses.eyesVisible = false
        let mixed = PhotoMetrics(faces: [open, sunglasses], sharpness: 0.8, exposure: 0.8)
        let bothOpen = PhotoMetrics(faces: [open, open], sharpness: 0.8, exposure: 0.8)
        for category in [SelectionCategory.bestSmiles, .groupShots, .portraits, .bestOverall] {
            XCTAssertEqual(Scorer.score(mixed, for: category), Scorer.score(bothOpen, for: category), accuracy: 1e-12, "\(category)")
        }
        // No visible eyes at all: the eye component drops out (smile 0.8×0.55, sharpness 0.8×0.1, quality 0.7×0.1).
        let hidden = PhotoMetrics(faces: [sunglasses], sharpness: 0.8, exposure: 0.8)
        XCTAssertEqual(Scorer.score(hidden, for: .bestSmiles), 0.59 / 0.75, accuracy: 1e-12)
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

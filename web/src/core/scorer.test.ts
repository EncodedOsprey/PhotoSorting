import { describe, expect, it } from 'vitest';
import { isEligible, overallScore, scoreFor } from './scorer';
import { SELECTION_CATEGORIES, type FaceMetrics, type PhotoMetrics } from './types';

const face = (overrides: Partial<FaceMetrics> = {}): FaceMetrics => ({
  smile: 0.8,
  eyesOpen: 0.9,
  captureQuality: 0.7,
  areaFraction: 0.05,
  ...overrides,
});

const photo = (overrides: Partial<PhotoMetrics> = {}): PhotoMetrics => ({
  faces: [],
  sharpness: 0.8,
  exposure: 0.8,
  aesthetics: null,
  isUtility: false,
  ...overrides,
});

const faces = (count: number, overrides: Partial<FaceMetrics> = {}) => Array.from({ length: count }, () => face(overrides));

describe('isEligible', () => {
  it('applies the per-category face rules', () => {
    const none = photo();
    const two = photo({ faces: faces(2) });
    const three = photo({ faces: faces(3) });
    const tinyFace = photo({ faces: faces(1, { areaFraction: 0.005 }) });

    expect(isEligible(two, 'groupShots')).toBe(false);
    expect(isEligible(three, 'groupShots')).toBe(true);
    expect(isEligible(none, 'noPeople')).toBe(true);
    expect(isEligible(two, 'noPeople')).toBe(false);
    expect(isEligible(none, 'bestSmiles')).toBe(false);
    expect(isEligible(none, 'eyesOpen')).toBe(false);
    expect(isEligible(two, 'portraits')).toBe(true);
    expect(isEligible(three, 'portraits')).toBe(false);
    expect(isEligible(tinyFace, 'portraits')).toBe(false);
    expect(isEligible(none, 'sharpest')).toBe(true);
  });

  it('never selects utility photos', () => {
    const utility = photo({ isUtility: true });
    for (const category of SELECTION_CATEGORIES) expect(isEligible(utility, category), category).toBe(false);
  });
});

describe('scoreFor', () => {
  it('lets one non-smiler pull down bestSmiles', () => {
    const smiling = face({ smile: 0.9, captureQuality: null });
    const frowning = face({ smile: 0.1, captureQuality: null });
    const all = photo({ faces: [smiling, smiling, smiling], sharpness: 0.7, exposure: 0.7 });
    const oneOff = photo({ faces: [smiling, smiling, frowning], sharpness: 0.7, exposure: 0.7 });
    expect(scoreFor(all, 'bestSmiles')).toBeGreaterThan(scoreFor(oneOff, 'bestSmiles') + 0.2);
  });

  it('keeps scores in 0...1 for out-of-range input, and bestOverall is the overall score', () => {
    const metrics = photo({
      faces: [...faces(2), face({ smile: Number.NaN, eyesOpen: 2 })],
      sharpness: 1.5,
      exposure: -0.2,
      aesthetics: 0.9,
    });
    for (const category of SELECTION_CATEGORIES) {
      const score = scoreFor(metrics, category);
      expect(score, category).toBeGreaterThanOrEqual(0);
      expect(score, category).toBeLessThanOrEqual(1);
    }
    expect(scoreFor(metrics, 'bestOverall')).toBe(overallScore(metrics));
  });

  it('ranks sharpness and exposure in their own categories', () => {
    const sharp = photo({ sharpness: 0.9, exposure: 0.5 });
    const soft = photo({ sharpness: 0.4, exposure: 0.9 });
    expect(scoreFor(sharp, 'sharpest')).toBeGreaterThan(scoreFor(soft, 'sharpest'));
    expect(scoreFor(soft, 'wellExposed')).toBeGreaterThan(scoreFor(sharp, 'wellExposed'));
  });

  it('matches the Swift formulas, renormalizing weights when a signal is missing', () => {
    const subject = face({ smile: 0.9, eyesOpen: 0.8, captureQuality: 0.5 });
    expect(scoreFor(photo({ faces: [subject], sharpness: 0.6 }), 'bestSmiles')).toBeCloseTo(0.805, 12);
    const noQuality = { ...subject, captureQuality: null };
    expect(scoreFor(photo({ faces: [noQuality], sharpness: 0.6 }), 'bestSmiles')).toBeCloseTo(0.755 / 0.9, 12);

    const portrait = face({ smile: 0.5, eyesOpen: 0.7, captureQuality: null, areaFraction: 0.1 });
    expect(scoreFor(photo({ faces: [portrait] }), 'portraits')).toBeCloseTo(0.615, 12);
    expect(scoreFor(photo({ sharpness: 0.6, exposure: 0.4, aesthetics: 0.8 }), 'noPeople')).toBeCloseTo(0.68, 12);
    expect(overallScore(photo({ sharpness: 0.5, exposure: 1 }))).toBeCloseTo(0.7, 12);
  });
});

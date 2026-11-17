import { describe, expect, it } from 'vitest';
import { BLURRY_THRESHOLD } from '../core';
import { isLikelyScreenshot, MAIN_SUBJECT_RATIO, photoSharpness } from './metrics';

describe('photoSharpness', () => {
  const faces = (...focus: Array<number | null>) => focus.map((score) => ({ focus: score, width: 100 }));

  it('follows the people: a soft minimum of the faces that can be judged', () => {
    expect(photoSharpness(faces(0.8), 0.3)).toEqual({ sharpness: 0.8, subjectSharpness: 0.8 });
    const { sharpness, subjectSharpness } = photoSharpness(faces(0.8, null, 0.2), 0.9);
    expect(sharpness).toBeCloseTo(0.6 * 0.2 + 0.4 * 0.5);
    expect(subjectSharpness).toBe(sharpness);
  });

  it('doesn’t let a sharp background make up for soft faces', () => {
    expect(photoSharpness(faces(0.04, 0.02), 0.8).sharpness).toBeLessThan(BLURRY_THRESHOLD);
  });

  it('judges the main subjects only: people further back may be soft', () => {
    const couple = [
      { focus: 0.8, width: 100 },
      { focus: 0.8, width: 90 },
    ];
    const guests = [
      { focus: 0.05, width: 40 },
      { focus: 0.1, width: 100 * MAIN_SUBJECT_RATIO - 1 },
    ];
    expect(photoSharpness([...couple, ...guests], 0.3).sharpness).toBeCloseTo(0.8);
    // A soft partner at the same distance still counts.
    expect(photoSharpness([couple[0], { focus: 0.05, width: 100 * MAIN_SUBJECT_RATIO }], 0.9).sharpness).toBeLessThan(BLURRY_THRESHOLD);
  });

  it('falls back to the whole image without a face that can be judged', () => {
    expect(photoSharpness([], 0.7)).toEqual({ sharpness: 0.7, subjectSharpness: null });
    expect(photoSharpness(faces(null, null), 0.7)).toEqual({ sharpness: 0.7, subjectSharpness: null });
    // The largest face decides who the main subjects are, even when it is too small to judge.
    expect(photoSharpness([{ focus: null, width: 100 }, { focus: 0.1, width: 30 }], 0.7)).toEqual({ sharpness: 0.7, subjectSharpness: null });
  });
});

describe('isLikelyScreenshot', () => {
  const png = { name: 'IMG_0042.PNG', type: 'image/png' };

  it('flags PNGs at an iPhone screen size without a capture date', () => {
    expect(isLikelyScreenshot(png, 1179, 2556, false)).toBe(true);
    expect(isLikelyScreenshot(png, 2556, 1179, false)).toBe(true);
    expect(isLikelyScreenshot({ name: 'shot.png', type: '' }, 1170, 2532, false)).toBe(true);
  });

  it('never flags camera photos', () => {
    expect(isLikelyScreenshot(png, 1179, 2556, true)).toBe(false);
    expect(isLikelyScreenshot({ name: 'IMG_0001.JPG', type: 'image/jpeg' }, 1179, 2556, false)).toBe(false);
    expect(isLikelyScreenshot(png, 3024, 4032, false)).toBe(false);
  });
});

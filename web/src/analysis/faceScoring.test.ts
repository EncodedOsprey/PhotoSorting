import { describe, expect, it } from 'vitest';
import { BLURRY_THRESHOLD, CLOSED_EYES_THRESHOLD } from '../core';
import {
  captureQuality,
  eyeModelTrust,
  eyeShapes,
  eyesOpenScore,
  faceSizeScore,
  focusRegions,
  focusScale,
  focusScore,
  frontalness,
  headPose,
  interOcularDistance,
  smileScore,
  EYE_MODEL_DETAIL_RANGE,
  EYE_MODEL_WIDTH_RANGE,
  FOCUS_IOD,
  FOCUS_MIN_IOD,
  SMALL_EYE_WIDTH_RANGE,
  type Blendshapes,
  type EyeModelReading,
  type EyeShape,
  type FocusRegion,
} from './faceScoring';

/** Blendshapes of a face whose eyes behave alike (values as MediaPipe reports them). */
function face({ smile = 0.03, blink = 0.1 } = {}): Blendshapes {
  return { mouthSmileLeft: smile, mouthSmileRight: smile, eyeBlinkLeft: blink, eyeBlinkRight: blink };
}

/** An eye with the given aspect ratio, 40 px wide by default. */
const eye = (aspect: number, width = 40): EyeShape => ({ aspect, width });
const bothEyes = (aspect: number, width?: number): [EyeShape, EyeShape] => [eye(aspect, width), eye(aspect, width)];

describe('smileScore', () => {
  it('maps closed-mouth faces to 0 and broad toothy smiles to 1', () => {
    expect(smileScore(face({ smile: 0.04 }))).toBe(0);
    expect(smileScore(face({ smile: 0.9 }))).toBe(1);
    expect(smileScore({})).toBe(0);
  });

  it('ranks a moderate smile between neutral and broad', () => {
    const moderate = smileScore(face({ smile: 0.44 }));
    expect(moderate).toBeGreaterThan(0.4);
    expect(moderate).toBeLessThan(0.8);
  });

  it('averages both mouth corners', () => {
    const lopsided = { mouthSmileLeft: 0.8, mouthSmileRight: 0.2 };
    expect(smileScore(lopsided)).toBeCloseTo(smileScore(face({ smile: 0.5 })), 10);
  });

  it('never decreases as the smile widens', () => {
    const scores = Array.from({ length: 21 }, (_, i) => smileScore(face({ smile: i / 20 })));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
  });
});

describe('eyesOpenScore', () => {
  /** An eye model reading of a sharp, 40 px wide eye. */
  const reading = (open: number, { detail = 2.6, width = 40 } = {}): EyeModelReading => ({ open, detail, width });
  const both = (eye: EyeModelReading): [EyeModelReading, EyeModelReading] => [eye, eye];

  it('reads wide-open eyes as open', () => {
    expect(eyesOpenScore(face(), bothEyes(0.25))).toBe(1);
    expect(eyesOpenScore(face(), bothEyes(0.25), both(reading(0.99)))).toBeGreaterThan(0.99);
    // A fixture smile with a confident model.
    expect(eyesOpenScore(face({ smile: 0.85 }), bothEyes(0.2), both(reading(0.99)))).toBeGreaterThan(0.8);
  });

  it('reads shut lids as closed, in a smile too, whatever the blink blendshape or the model says', () => {
    expect(eyesOpenScore(face({ blink: 0.1 }), bothEyes(0.06), both(reading(0.9)))).toBe(0);
    expect(eyesOpenScore(face({ smile: 0.85, blink: 0.55 }), bothEyes(0.08))).toBeLessThan(CLOSED_EYES_THRESHOLD);
  });

  it('ranks eyes narrowed to a slit between open and closed', () => {
    const narrowed = eyesOpenScore(face({ smile: 0.85 }), bothEyes(0.17), both(reading(0.9)));
    expect(narrowed).toBeGreaterThan(CLOSED_EYES_THRESHOLD);
    expect(narrowed).toBeLessThan(0.7);
  });

  it('lets a sharp crop of a big eye overrule lids that the landmarks place open', () => {
    expect(eyesOpenScore(face(), bothEyes(0.3), both(reading(0.01)))).toBeLessThan(CLOSED_EYES_THRESHOLD);
    // The model alone can't make a closed eye open.
    expect(eyesOpenScore(face(), bothEyes(0.1), both(reading(1)))).toBe(0);
  });

  it('ignores the model on blurred or small eye crops', () => {
    const closedReading = (options: { detail?: number; width?: number }) => both(reading(0.01, options));
    expect(eyesOpenScore(face(), bothEyes(0.3), closedReading({ detail: EYE_MODEL_DETAIL_RANGE[0] }))).toBe(1);
    expect(eyesOpenScore(face(), bothEyes(0.3), closedReading({ width: EYE_MODEL_WIDTH_RANGE[0] }))).toBe(1);
    const partly = eyesOpenScore(face(), bothEyes(0.3), closedReading({ detail: 1.9 }));
    expect(partly).toBeGreaterThan(eyesOpenScore(face(), bothEyes(0.3), closedReading({})));
    expect(partly).toBeLessThan(1);
  });

  it('scores a wink by the closed eye, on either side', () => {
    const winkScore = eyesOpenScore(face(), [eye(0.25), eye(0.05)], [reading(0.99), reading(0.02)]);
    expect(winkScore).toBe(0);
    expect(eyesOpenScore(face(), [eye(0.05), eye(0.25)], [reading(0.02), reading(0.99)])).toBe(winkScore);
    expect(eyesOpenScore(face(), bothEyes(0.3), [reading(0.99), reading(0.01)])).toBeLessThan(CLOSED_EYES_THRESHOLD);
  });

  it('judges small eyes, whose lids the landmarks place less precisely, more leniently', () => {
    // A narrow open eye in a group photo passes as open when 9 px wide but not at portrait size.
    expect(eyesOpenScore(face(), bothEyes(0.12, 9))).toBeGreaterThan(0.7);
    expect(eyesOpenScore(face(), bothEyes(0.12, SMALL_EYE_WIDTH_RANGE[1]))).toBe(0);
    // Shut lids still count as closed.
    expect(eyesOpenScore(face(), bothEyes(0.05, 9))).toBeLessThan(CLOSED_EYES_THRESHOLD);
    let previous = -1;
    for (let width = 30; width >= 4; width--) {
      const value = eyesOpenScore(face(), bothEyes(0.14, width));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('falls back to the blink blendshape without eye landmarks', () => {
    expect(eyesOpenScore(face({ blink: 0.1 }), bothEyes(0))).toBe(1);
    expect(eyesOpenScore(face({ blink: 0.9 }), bothEyes(0))).toBe(0);
  });

  it('never decreases as the eye opens or the model grows surer it is open', () => {
    for (const readings of [undefined, both(reading(0.5)), both(reading(0.95, { detail: 1.9, width: 15 }))]) {
      let previous = -1;
      for (let aspect = 0.01; aspect <= 0.4; aspect += 0.01) {
        const value = eyesOpenScore(face(), bothEyes(aspect), readings);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
    let previous = -1;
    for (let open = 0; open <= 1; open += 0.05) {
      const value = eyesOpenScore(face(), bothEyes(0.2), both(reading(open)));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('eyeModelTrust', () => {
  it('trusts the model fully on big, sharp eyes only, more as either grows', () => {
    expect(eyeModelTrust({ detail: EYE_MODEL_DETAIL_RANGE[1], width: EYE_MODEL_WIDTH_RANGE[1] })).toBe(1);
    expect(eyeModelTrust({ detail: 3, width: EYE_MODEL_WIDTH_RANGE[0] })).toBe(0);
    expect(eyeModelTrust({ detail: EYE_MODEL_DETAIL_RANGE[0], width: 60 })).toBe(0);
    let previous = -1;
    for (let step = 0; step <= 10; step++) {
      const trust = eyeModelTrust({ detail: 1.6 + step * 0.06, width: 10 + step });
      expect(trust).toBeGreaterThanOrEqual(previous);
      previous = trust;
    }
  });
});

describe('headPose', () => {
  /** Column-major 4×4 rotation (about the y or x axis) followed by a translation away from the camera. */
  function rotation(axis: 'x' | 'y', degrees: number): number[] {
    const c = Math.cos((degrees * Math.PI) / 180);
    const s = Math.sin((degrees * Math.PI) / 180);
    const columns =
      axis === 'y'
        ? [[c, 0, -s], [0, 1, 0], [s, 0, c]]
        : [[1, 0, 0], [0, c, s], [0, -s, c]];
    return [...columns.flatMap((column) => [...column, 0]), 0, 0, -40, 1];
  }

  it('is frontal for the identity rotation', () => {
    const pose = headPose(rotation('y', 0))!;
    expect(pose.yaw).toBeCloseTo(0);
    expect(pose.pitch).toBeCloseTo(0);
    expect(pose.offAxis).toBeCloseTo(0);
  });

  it('measures yaw and pitch in degrees', () => {
    const turned = headPose(rotation('y', 30))!;
    expect(Math.abs(turned.yaw)).toBeCloseTo(30);
    expect(turned.pitch).toBeCloseTo(0);
    expect(turned.offAxis).toBeCloseTo(30);
    const tilted = headPose(rotation('x', 20))!;
    expect(tilted.yaw).toBeCloseTo(0);
    expect(Math.abs(tilted.pitch)).toBeCloseTo(20);
    expect(tilted.offAxis).toBeCloseTo(20);
  });

  it('rejects missing or degenerate matrices', () => {
    expect(headPose([])).toBeNull();
    expect(headPose(new Array(16).fill(0))).toBeNull();
  });
});

describe('capture quality parts', () => {
  it('frontalness: full up to 15°, none from 60° (profile)', () => {
    expect(frontalness(0)).toBe(1);
    expect(frontalness(15)).toBe(1);
    expect(frontalness(37.5)).toBeCloseTo(0.5);
    expect(frontalness(60)).toBe(0);
    expect(frontalness(120)).toBe(0);
  });

  it('faceSizeScore: log scale from 40 px (useless) to 320 px (plenty)', () => {
    expect(faceSizeScore(20)).toBe(0);
    expect(faceSizeScore(40)).toBe(0);
    expect(faceSizeScore(80)).toBeCloseTo(1 / 3);
    expect(faceSizeScore(160)).toBeCloseTo(2 / 3);
    expect(faceSizeScore(320)).toBe(1);
    expect(faceSizeScore(4000)).toBe(1);
  });

  it('captureQuality: focus outweighs pose, which outweighs size; stays within 0...1', () => {
    const sharpProfile = captureQuality({ sharpness: 1, frontalness: 0, size: 0 });
    const blurryFrontal = captureQuality({ sharpness: 0, frontalness: 1, size: 0 });
    const blurrySmallFrontal = captureQuality({ sharpness: 0, frontalness: 0, size: 1 });
    expect(sharpProfile).toBeGreaterThan(blurryFrontal);
    expect(blurryFrontal).toBeGreaterThan(blurrySmallFrontal);
    expect(captureQuality({ sharpness: 1, frontalness: 1, size: 1 })).toBe(1);
    expect(captureQuality({ sharpness: 5, frontalness: -1, size: Number.NaN })).toBe(sharpProfile);
  });
});

describe('focusRegions', () => {
  // Landmarks of a frontal studio portrait (face-image pixels): the face outline, the points of the focus regions and
  // the upper lip.
  const OUTLINE: [number, number][] = [
    [193, 1], [243, 1], [285, 9], [324, 25], [351, 49], [368, 80], [377, 112], [380, 152], [379, 192], [376, 233],
    [371, 277], [358, 321], [340, 356], [319, 382], [294, 407], [274, 426], [253, 442], [228, 453], [195, 457],
    [162, 454], [135, 444], [113, 429], [91, 411], [64, 388], [42, 362], [22, 327], [9, 281], [4, 237], [2, 196],
    [0, 156], [4, 115], [14, 83], [31, 52], [59, 27], [100, 11], [143, 3],
  ];
  const MESH: Record<number, [number, number]> = {
    263: [306, 143], 362: [239, 149], 374: [275, 152], 300: [342, 107], 293: [325, 92], 334: [299, 83], 296: [266, 84],
    336: [230, 88], 33: [80, 145], 133: [147, 149], 145: [112, 152], 70: [41, 109], 63: [59, 94], 105: [86, 85],
    66: [121, 85], 107: [158, 89], 0: [196, 304],
  };

  /**
   * The face mesh and its outline, rolled by `degrees` around the face center, after squeezing it to `turn` of its
   * width like a head turned sideways (cos of the turn).
   */
  function face(degrees = 0, turn = 1): { points: { x: number; y: number }[]; outline: { x: number; y: number }[] } {
    const angle = (degrees * Math.PI) / 180;
    const transform = ([x, y]: [number, number]) => {
      const dx = (x - 190) * turn;
      return {
        x: 190 + dx * Math.cos(angle) - (y - 228) * Math.sin(angle),
        y: 228 + dx * Math.sin(angle) + (y - 228) * Math.cos(angle),
      };
    };
    const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
    for (const [index, point] of Object.entries(MESH)) points[Number(index)] = transform(point);
    return { points, outline: OUTLINE.map(transform) };
  }

  function inside(polygon: { x: number; y: number }[], { x, y }: { x: number; y: number }): boolean {
    let crossings = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [a, b] = [polygon[i], polygon[j]];
      if (a.y > y !== b.y > y && x < a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)) crossings++;
    }
    return crossings % 2 === 1;
  }

  const corners = ({ x, y, width, height }: FocusRegion) => [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ];

  it('boxes each eye between its corners, from the top of the brow to the lower lid, subject’s left eye first', () => {
    expect(focusRegions(face().points)).toEqual([
      { x: 239, y: 83, width: 67, height: 69 },
      { x: 80, y: 85, width: 67, height: 67 },
    ]);
  });

  it('stays inside the face when the head is tilted', () => {
    for (const degrees of [0, 15, -15, 30, -30]) {
      const { points, outline } = face(degrees);
      const regions = focusRegions(points);
      expect(regions).toHaveLength(2);
      for (const corner of regions.flatMap(corners)) expect(inside(outline, corner), `${degrees}°`).toBe(true);
    }
  });

  it('measures the eye distance of the face seen from the front, whatever the tilt or turn', () => {
    const frontal = interOcularDistance(face().points);
    expect(frontal).toBeCloseTo(159, 0);
    expect(interOcularDistance(face(30).points)).toBeCloseTo(frontal);
    // Turned 60°, the eyes look half as far apart; the eye-to-lip distance stands in.
    const turned = interOcularDistance(face(0, 0.5).points);
    expect(turned).toBeGreaterThan(0.85 * frontal);
    expect(turned).toBeLessThanOrEqual(frontal);
    expect(interOcularDistance(face(30, 0.5).points)).toBeCloseTo(turned);
  });

  it('returns nothing when landmarks are missing', () => {
    expect(focusRegions([])).toEqual([]);
    expect(focusRegions(face().points.slice(0, 300))).toEqual([]);
    expect(interOcularDistance(face().points.slice(0, 300))).toBe(0);
  });
});

describe('focus scores', () => {
  it('focusScale: down to FOCUS_IOD, never up; null when the face is too small to judge', () => {
    expect(focusScale(4 * FOCUS_IOD)).toBe(0.25);
    expect(focusScale(FOCUS_IOD)).toBe(1);
    expect(focusScale(FOCUS_MIN_IOD)).toBe(1);
    expect(focusScale(FOCUS_MIN_IOD - 0.5)).toBeNull();
    expect(focusScale(Number.NaN)).toBeNull();
  });

  it('focusScore: calibrated eye regions order as expected', () => {
    expect(focusScore(0, 150)).toBe(0);
    expect(focusScore(Number.NaN, 150)).toBe(0);
    expect(focusScore(1653, 150)).toBeCloseTo(0.81, 2); // median sharp studio portrait
    expect(focusScore(21, 150)).toBeLessThan(BLURRY_THRESHOLD); // Gaussian blur, 0.5% of the long edge
    expect(focusScore(8, 150)).toBeLessThan(0.05); // 0.9% blur
    expect(focusScore(1e7, 150)).toBeLessThan(1);
  });

  it('focusScore: never decreases as the variance grows', () => {
    let previous = 0;
    for (let variance = 1; variance < 1e5; variance *= 1.5) {
      const value = focusScore(variance, 150);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('focusScore: faces measured below FOCUS_IOD need proportionally more variance', () => {
    expect(focusScore(800, FOCUS_IOD)).toBe(focusScore(800, 4 * FOCUS_IOD));
    expect(focusScore(800, FOCUS_IOD / 2)).toBeLessThan(focusScore(800, FOCUS_IOD));
    expect(focusScore(1600, FOCUS_IOD / 2)).toBeCloseTo(focusScore(800, FOCUS_IOD));
  });
});

describe('eyeShapes', () => {
  /** A 478-point face mesh with only the eye points placed: each eye 20 px wide with the given lid gap. */
  function mesh(leftGap: number, rightGap: number): { x: number; y: number }[] {
    const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
    const eye = (outer: number, inner: number, lids: [number, number][], cx: number, gap: number) => {
      points[outer] = { x: cx + 10, y: 50 };
      points[inner] = { x: cx - 10, y: 50 };
      for (const [upper, lower] of lids) {
        points[upper] = { x: cx, y: 50 - gap / 2 };
        points[lower] = { x: cx, y: 50 + gap / 2 };
      }
    };
    eye(263, 362, [[385, 380], [387, 373]], 100, leftGap);
    eye(33, 133, [[160, 144], [158, 153]], 40, rightGap);
    return points;
  }

  it('measures the eye width and lid gap over it, subject’s left eye first', () => {
    const [left, right] = eyeShapes(mesh(6, 2));
    expect(left.aspect).toBeCloseTo(0.3);
    expect(right.aspect).toBeCloseTo(0.1);
    expect(left.width).toBeCloseTo(20);
    expect(right.width).toBeCloseTo(20);
  });

  it('returns zeros when landmarks are missing', () => {
    const missing = [eye(0, 0), eye(0, 0)];
    expect(eyeShapes([])).toEqual(missing);
    expect(eyeShapes(mesh(6, 2).slice(0, 100))).toEqual(missing);
  });
});

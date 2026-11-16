import { describe, expect, it } from 'vitest';
import { CLOSED_EYES_THRESHOLD } from '../core';
import {
  captureQuality,
  eyeAspectRatios,
  eyesOpenScore,
  faceSharpnessScore,
  faceSizeScore,
  frontalness,
  headPose,
  smileScore,
  type Blendshapes,
} from './faceScoring';

/** Blendshapes of a face whose eyes behave alike (values as MediaPipe reports them). */
function face({ smile = 0.03, blink = 0.1, lookDown = 0.05 } = {}): Blendshapes {
  return {
    mouthSmileLeft: smile,
    mouthSmileRight: smile,
    eyeBlinkLeft: blink,
    eyeBlinkRight: blink,
    eyeLookDownLeft: lookDown,
    eyeLookDownRight: lookDown,
  };
}

const bothEyes = (aspect: number): [number, number] => [aspect, aspect];

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
  it('reads open eyes of a neutral face as open', () => {
    expect(eyesOpenScore(face(), bothEyes(0.25))).toBeGreaterThan(0.99);
    // 1st-percentile eye aspect and 99th-percentile blink of 300 studio portraits with open eyes.
    expect(eyesOpenScore(face({ blink: 0.37 }), bothEyes(0.146))).toBeGreaterThan(0.9);
  });

  it('reads shut lids as closed even when the blink blendshape is undecided', () => {
    expect(eyesOpenScore(face({ blink: 0.55 }), bothEyes(0.06))).toBeLessThan(CLOSED_EYES_THRESHOLD);
  });

  it('trusts a clearly open eye over a blink misfire', () => {
    expect(eyesOpenScore(face({ blink: 0.9 }), bothEyes(0.3))).toBeGreaterThan(0.9);
  });

  it('keeps eyes narrowed by a broad (Duchenne) smile open', () => {
    expect(eyesOpenScore(face({ smile: 0.85, blink: 0.55 }), bothEyes(0.08))).toBeGreaterThan(0.7);
    // The same narrow eye without a smile looks shut.
    expect(eyesOpenScore(face({ blink: 0.55 }), bothEyes(0.08))).toBeLessThan(CLOSED_EYES_THRESHOLD);
  });

  it('still catches closed eyes in a smile when lids and blink agree', () => {
    expect(eyesOpenScore(face({ smile: 0.85, blink: 0.85 }), bothEyes(0.04))).toBeLessThan(CLOSED_EYES_THRESHOLD);
  });

  it('does not read a lowered gaze as closed', () => {
    const lookingDown = eyesOpenScore(face({ lookDown: 0.7, blink: 0.45 }), bothEyes(0.1));
    expect(lookingDown).toBeGreaterThan(0.6);
    expect(lookingDown).toBeGreaterThan(eyesOpenScore(face({ blink: 0.45 }), bothEyes(0.1)));
  });

  it('scores a wink by the closed eye, on either side', () => {
    const wink = { ...face(), eyeBlinkRight: 0.7 };
    const winkScore = eyesOpenScore(wink, [0.25, 0.05]);
    expect(winkScore).toBeLessThan(CLOSED_EYES_THRESHOLD);
    const mirrored = { ...face(), eyeBlinkLeft: 0.7 };
    expect(eyesOpenScore(mirrored, [0.05, 0.25])).toBeCloseTo(winkScore, 10);
  });

  it('falls back to the blink blendshape without eye landmarks', () => {
    expect(eyesOpenScore(face({ blink: 0.1 }), bothEyes(0))).toBe(1);
    expect(eyesOpenScore(face({ blink: 0.9 }), bothEyes(0))).toBe(0);
  });

  it('never decreases as the eye opens', () => {
    for (const expression of [face(), face({ smile: 0.85, blink: 0.6 }), face({ lookDown: 0.5, blink: 0.5 })]) {
      let previous = -1;
      for (let aspect = 0.01; aspect <= 0.4; aspect += 0.01) {
        const value = eyesOpenScore(expression, bothEyes(aspect));
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
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

  it('faceSharpnessScore: calibrated face crops order as expected', () => {
    expect(faceSharpnessScore(0)).toBe(0);
    expect(faceSharpnessScore(Number.NaN)).toBe(0);
    expect(faceSharpnessScore(4)).toBeLessThan(0.1); // strong Gaussian blur
    expect(faceSharpnessScore(352)).toBeGreaterThan(0.7); // median studio portrait
    expect(faceSharpnessScore(1e6)).toBeLessThan(1);
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

describe('eyeAspectRatios', () => {
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

  it('measures lid gap over eye width, subject’s left eye first', () => {
    const [left, right] = eyeAspectRatios(mesh(6, 2));
    expect(left).toBeCloseTo(0.3);
    expect(right).toBeCloseTo(0.1);
  });

  it('returns 0 when landmarks are missing', () => {
    expect(eyeAspectRatios([])).toEqual([0, 0]);
    expect(eyeAspectRatios(mesh(6, 2).slice(0, 100))).toEqual([0, 0]);
  });
});

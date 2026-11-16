// Pure mappings from MediaPipe Face Landmarker outputs (blendshapes, landmarks, pose matrix) and pixel
// measurements to the 0...1 FaceMetrics scores. Calibration notes are next to each constant.

/** Blendshape scores by category name (MediaPipe's 52 ARKit-style names; Left/Right are the subject's sides). */
export type Blendshapes = Readonly<Record<string, number>>;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 0 below edge0, 1 above edge1, smooth (C1) in between. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

const score = (blendshapes: Blendshapes, name: string): number => clamp01(blendshapes[name] ?? 0);

// MARK: - Smile

/**
 * Raw mouthSmile (mean of both sides) → 0...1. Calibration: closed-mouth neutral portraits read 0.02–0.05 and a
 * faint smile 0.27 (fixtures), a moderate toothy smile 0.44 (portrait-smile-a), broad smiles 0.85–0.95 (fixtures;
 * median of 300 CC0 Congress portraits 0.85). The upper edge sits below broad smiles but above moderate ones, so
 * "Best Smiles" still ranks a big smile over a polite one.
 */
export const SMILE_RAW_RANGE = [0.1, 0.75] as const;

export function rawSmile(blendshapes: Blendshapes): number {
  return (score(blendshapes, 'mouthSmileLeft') + score(blendshapes, 'mouthSmileRight')) / 2;
}

export function smileScore(blendshapes: Blendshapes): number {
  return smoothstep(SMILE_RAW_RANGE[0], SMILE_RAW_RANGE[1], rawSmile(blendshapes));
}

// MARK: - Eyes

/**
 * Eye openness combines two signals that fail differently:
 * - the eye aspect ratio (EAR, lid gap / eye width) of the landmark mesh, which is regressed from pixels. 300 CC0
 *   Congress portraits (all eyes open) measure ≥ 0.115 (1st percentile 0.146, median 0.247); eyelids painted shut
 *   over real portraits measure 0.04–0.09 (fixtures, 56–375 px faces).
 * - the eyeBlink blendshape, computed from the landmarks alone: open eyes read ≤ 0.4, but it misfires on small
 *   faces (0.65–0.91 on one clearly open eye whose EAR is 0.19–0.41) and shut lids often read only 0.45–0.65.
 * The EAR decides by default. Smiles (cheeks push the lower lids up) and a lowered gaze narrow open eyes to an EAR
 * of 0.06–0.12, so in that "squint context" the EAR band moves down and the blink must agree as well. Shut lids
 * also raise eyeLookDown (0.3–0.6), so the gaze only counts half.
 */
export const EYE_ASPECT_RANGE = [0.07, 0.16] as const;
export const EYE_ASPECT_SQUINT_SHIFT = 0.04;
export const EYE_BLINK_RANGE = [0.35, 0.75] as const;
export const EYE_BLINK_SQUINT_SHIFT = 0.15;
const LOOK_DOWN_CONTEXT_WEIGHT = 0.5;

export interface EyeSignals {
  /** eyeBlinkLeft/Right blendshape. */
  blink: number;
  /** eyeLookDownLeft/Right blendshape. */
  lookDown: number;
  /** Eye aspect ratio from landmarks (see eyeAspectRatios); 0 when unavailable. */
  aspect: number;
}

/** Per-eye signals, [subject's left, subject's right]. */
export function eyeSignals(blendshapes: Blendshapes, aspects: readonly [number, number]): [EyeSignals, EyeSignals] {
  const side = (suffix: 'Left' | 'Right', aspect: number): EyeSignals => ({
    blink: score(blendshapes, `eyeBlink${suffix}`),
    lookDown: score(blendshapes, `eyeLookDown${suffix}`),
    aspect,
  });
  return [side('Left', aspects[0]), side('Right', aspects[1])];
}

/** 0 = neutral face, 1 = an expression that explains narrowed open eyes (broad smile or a clearly lowered gaze). */
export function squintContext(smileRawValue: number, lookDown: number): number {
  return Math.max(smoothstep(0.2, 0.6, smileRawValue), LOOK_DOWN_CONTEXT_WEIGHT * smoothstep(0.2, 0.6, lookDown));
}

/** Openness 0...1 of one eye. */
export function eyeOpenness(eye: EyeSignals, smileRawValue: number): number {
  const context = squintContext(smileRawValue, eye.lookDown);
  const blinkShift = EYE_BLINK_SQUINT_SHIFT * context;
  const blinkClosed = smoothstep(EYE_BLINK_RANGE[0] + blinkShift, EYE_BLINK_RANGE[1] + blinkShift, clamp01(eye.blink));
  if (!(eye.aspect > 0)) return 1 - blinkClosed;
  const aspectShift = EYE_ASPECT_SQUINT_SHIFT * context;
  const aspectClosed = 1 - smoothstep(EYE_ASPECT_RANGE[0] - aspectShift, EYE_ASPECT_RANGE[1] - aspectShift, eye.aspect);
  const closed = (1 - context) * aspectClosed + context * Math.sqrt(aspectClosed * blinkClosed);
  return clamp01(1 - closed);
}

/** The less open eye: a wink or a half blink counts as closed. */
export function eyesOpenScore(blendshapes: Blendshapes, aspects: readonly [number, number]): number {
  const smile = rawSmile(blendshapes);
  const [left, right] = eyeSignals(blendshapes, aspects);
  return Math.min(eyeOpenness(left, smile), eyeOpenness(right, smile));
}

// MARK: - Pose

export interface HeadPose {
  /** Degrees, positive = face turned towards the image's left... sign is informational only. */
  yaw: number;
  pitch: number;
  /** Angle between the face's forward direction and the camera axis, degrees (0 = looking straight at the camera). */
  offAxis: number;
}

/**
 * Head pose from MediaPipe's 4×4 facial transformation matrix (column-major, canonical face → camera space,
 * camera looking down −Z with +Y up). The face's forward axis is the matrix's third column.
 */
export function headPose(matrix: ArrayLike<number>): HeadPose | null {
  if (matrix.length < 16) return null;
  const fx = matrix[8];
  const fy = matrix[9];
  const fz = matrix[10];
  const length = Math.hypot(fx, fy, fz);
  if (!(length > 0)) return null;
  const toDegrees = 180 / Math.PI;
  return {
    yaw: Math.atan2(fx, fz) * toDegrees,
    pitch: Math.atan2(fy, Math.hypot(fx, fz)) * toDegrees,
    offAxis: Math.acos(Math.min(1, Math.max(-1, fz / length))) * toDegrees,
  };
}

/** 1 when facing the camera within 15°, falling linearly to 0 at 60° (profile views make poor keepers). */
export function frontalness(offAxisDegrees: number): number {
  return 1 - clamp01((offAxisDegrees - 15) / 45);
}

// MARK: - Capture quality

/** Face crops are measured at most this many pixels wide so the sharpness scale doesn't depend on face size. */
export const FACE_SHARPNESS_WIDTH = 128;

/**
 * Laplacian variance of a face crop (FACE_SHARPNESS_WIDTH wide) → 0...1 as v / (v + HALF). Calibration: 300 CC0
 * Congress studio portraits measure 50 / 352 / 1225 (1st / 50th / 99th percentile) → 0.33 / 0.78 / 0.92; the
 * fixture portrait with mild Gaussian blur 62 → 0.38, strong blur 4 → 0.04.
 */
export const FACE_SHARPNESS_HALF = 100;

export function faceSharpnessScore(laplacianVariance: number): number {
  if (!Number.isFinite(laplacianVariance) || laplacianVariance <= 0) return 0;
  return laplacianVariance / (laplacianVariance + FACE_SHARPNESS_HALF);
}

/** Face width in original-image pixels → 0...1 on a log scale: ≤40 px useless, ≥320 px plenty for any print. */
export function faceSizeScore(faceWidthPixels: number): number {
  if (!(faceWidthPixels > 40)) return 0;
  return clamp01(Math.log2(faceWidthPixels / 40) / 3);
}

/** Weighted blend: focus on the face matters most, then pose, then how many pixels the face got. */
export function captureQuality(parts: { sharpness: number; frontalness: number; size: number }): number {
  return clamp01(0.5 * clamp01(parts.sharpness) + 0.3 * clamp01(parts.frontalness) + 0.2 * clamp01(parts.size));
}

// MARK: - Landmark geometry

/** Face-mesh indices: [outer corner, inner corner, upper lid ×2, lower lid ×2] per eye (subject's left, right). */
const EYE_POINTS = {
  left: [263, 362, 385, 387, 380, 373],
  right: [33, 133, 160, 158, 144, 153],
} as const;

/**
 * Eye aspect ratio (mean lid gap / eye width) per eye, [subject's left, subject's right], from landmarks in pixels
 * (x and y must share one scale). Open eyes measure ~0.15–0.34, shut lids ~0.04–0.09; 0 when landmarks are missing.
 */
export function eyeAspectRatios(points: ReadonlyArray<{ x: number; y: number }>): [number, number] {
  const ratio = ([outer, inner, upper1, upper2, lower1, lower2]: readonly number[]): number => {
    if (points.length <= Math.max(outer, inner, upper1, upper2, lower1, lower2)) return 0;
    const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    const width = distance(outer, inner);
    return width > 0 ? (distance(upper1, lower1) + distance(upper2, lower2)) / (2 * width) : 0;
  };
  return [ratio(EYE_POINTS.left), ratio(EYE_POINTS.right)];
}

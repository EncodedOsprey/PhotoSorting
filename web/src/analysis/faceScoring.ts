// Pure mappings from MediaPipe Face Landmarker outputs (blendshapes, landmarks, pose matrix), the eye models' outputs
// and pixel measurements to the 0...1 FaceMetrics scores. Calibration notes are next to each constant.

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
 * Eye openness fuses two signals that fail differently:
 * - the eye aspect ratio (EAR, lid gap / eye width, see eyeShapes) of the landmark mesh: open eyes in CC0
 *   Congress portraits measure 0.146 at the 1st percentile (median 0.247; smiles narrow them a little), lids painted
 *   shut 0.03–0.12.
 * - OCEC-S, a small CNN that reads a crop of the eye (eyeModels.ts), so it sees lids that the mesh misplaces. It is
 *   only trusted on crops of eyes that are big enough (EYE_MODEL_WIDTH_RANGE) and sharp (EYE_MODEL_DETAIL_RANGE).
 * Each eye scores the geometric mean of the two, the model weighted by that trust. Calibration on 253 hand-labelled
 * eyes in CREMA-D video frames (77 open, 81 half closed, 95 closed): open vs. the rest AUC 0.963 (EAR alone 0.936);
 * 5% of open eyes score below EYES_OPEN_MINIMUM (0.5), 49% of half-closed (EAR alone 58%) and 1% of closed eyes
 * reach it, 4% of closed eyes reach CLOSED_EYES_THRESHOLD (0.3; EAR alone 9.5%). 1.4% of 280 open eyes in Congress
 * portraits score below 0.5. Small eyes are judged on a lower range (SMALL_EYE_ASPECT_RANGE).
 */
export const EYE_ASPECT_RANGE = [0.12, 0.25] as const;
/**
 * The EAR range for eyes at most SMALL_EYE_WIDTH_RANGE[0] px wide (between the corners); it blends into
 * EYE_ASPECT_RANGE over SMALL_EYE_WIDTH_RANGE. On small eyes the landmarks place the lids less precisely, so narrow
 * open eyes (smiles, glasses) can measure like half-closed ones: Congress portraits shrunk until their eyes were
 * 8–12 px wide (as in group photos) score below CLOSED_EYES_THRESHOLD with EYE_ASPECT_RANGE for 5% of faces, and
 * with this range for 0.8%, while 99% of shut eyes (CREMA-D blinks shrunk the same way) and 72% of the hand-labelled
 * closed eyes still do. Half-closed eyes that small mostly pass as open.
 */
export const SMALL_EYE_ASPECT_RANGE = [0.05, 0.15] as const;
export const SMALL_EYE_WIDTH_RANGE = [8, 16] as const;
/** Eye width (pixels between the corners) over which the model's weight ramps up: smaller eyes are mostly upscaled. */
export const EYE_MODEL_WIDTH_RANGE = [12, 20] as const;
/**
 * cropDetail (eyeModels.ts) over which the model's weight ramps up. The model reads blurred open eyes as closed:
 * blurred by 4 / 6 / 8% of the eye width, 18 / 47 / 75% of open eyes in Congress portraits fall below 0.5, as their
 * detail drops from 2.6 (median; 10th percentile 2.1) to 1.8 / 1.6 / 1.5. With this ramp 7 / 7 / 10% of the fused
 * scores do (EAR alone 4 / 6 / 10%), while closed eyes keep their detail (CREMA-D 10th percentile 2.0) and the
 * CREMA-D results above are unchanged.
 */
export const EYE_MODEL_DETAIL_RANGE = [1.7, 2.1] as const;
/** Without landmarks: eyeBlink blendshape → closed. Open eyes read ≤ 0.4, but small faces misfire. */
export const EYE_BLINK_RANGE = [0.35, 0.75] as const;
/**
 * SGC-S probability (eyeModels.ts) at which a face counts as wearing sunglasses: its eyes aren't visible, so their
 * openness doesn't count. On CMU face images it finds 97.5% of the faces with sunglasses and 1.6% of the others;
 * no face in 240 Congress portraits (max 0.58) or 455 CREMA-D videos (max 0.23) reaches it.
 */
export const SUNGLASSES_THRESHOLD = 0.7;

/** What the eye model saw (EyeReading in eyeModels.ts). */
export interface EyeModelReading {
  /** Probability that the eye is open. */
  open: number;
  /** cropDetail of the crop. */
  detail: number;
  /** Distance between the eye corners in pixels. */
  width: number;
}

/** How far the eye model can be trusted, 0...1: on big, sharp crops only. */
export function eyeModelTrust({ detail, width }: Pick<EyeModelReading, 'detail' | 'width'>): number {
  return smoothstep(EYE_MODEL_WIDTH_RANGE[0], EYE_MODEL_WIDTH_RANGE[1], width) * smoothstep(EYE_MODEL_DETAIL_RANGE[0], EYE_MODEL_DETAIL_RANGE[1], detail);
}

/** The EAR range (closed → open) for an eye `width` px wide: SMALL_EYE_ASPECT_RANGE blending into EYE_ASPECT_RANGE. */
export function eyeAspectRange(width: number): [number, number] {
  const t = smoothstep(SMALL_EYE_WIDTH_RANGE[0], SMALL_EYE_WIDTH_RANGE[1], width);
  const blend = (small: number, big: number) => small * (1 - t) + big * t;
  return [blend(SMALL_EYE_ASPECT_RANGE[0], EYE_ASPECT_RANGE[0]), blend(SMALL_EYE_ASPECT_RANGE[1], EYE_ASPECT_RANGE[1])];
}

/** Openness 0...1 of one eye from its landmark shape (aspect 0 = no landmarks), eyeBlink blendshape and model reading. */
export function eyeOpenness(eye: EyeShape, blink: number, model: EyeModelReading | null): number {
  if (!(eye.aspect > 0)) return 1 - smoothstep(EYE_BLINK_RANGE[0], EYE_BLINK_RANGE[1], clamp01(blink));
  const [closed, open] = eyeAspectRange(eye.width);
  const geometry = smoothstep(closed, open, eye.aspect);
  if (!model) return geometry;
  const weight = eyeModelTrust(model) / 2;
  return geometry ** (1 - weight) * clamp01(model.open) ** weight;
}

/**
 * The less open eye (a wink or a half blink counts as closed), from the eye shapes and model readings, each
 * [subject's left, subject's right].
 */
export function eyesOpenScore(
  blendshapes: Blendshapes,
  eyes: readonly [EyeShape, EyeShape],
  readings: readonly [EyeModelReading | null, EyeModelReading | null] = [null, null],
): number {
  return Math.min(
    eyeOpenness(eyes[0], score(blendshapes, 'eyeBlinkLeft'), readings[0]),
    eyeOpenness(eyes[1], score(blendshapes, 'eyeBlinkRight'), readings[1]),
  );
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

// MARK: - Focus

/**
 * Face-mesh indices of the focus regions, per eye (subject's left, right): between the eye corners, from the top
 * of the brow to the lower lid. Lashes, lids, iris and brows are what photographers judge focus on, and a box per
 * eye stays inside the face when the head is turned or tilted (one band across both eyes takes in background).
 */
const FOCUS_EYES = [
  { corners: [263, 362], lowerLid: 374, brow: [300, 293, 334, 296, 336] },
  { corners: [33, 133], lowerLid: 145, brow: [70, 63, 105, 66, 107] },
] as const;
const FOCUS_POINT_COUNT = 1 + Math.max(...FOCUS_EYES.flatMap(({ corners, lowerLid, brow }) => [...corners, lowerLid, ...brow]));
/** Face-mesh index of the middle of the upper lip's edge. */
const UPPER_LIP = 0;
/**
 * Inter-ocular distance per pixel from between the eyes to the upper lip of a face seen from the front: the 5th
 * percentile of 152 studio portraits (median 1.02), so a face only counts as turned when its eyes look clearly close.
 */
const EYE_LIP_RATIO = 0.89;

/** Rectangle in the landmarks' pixel space. */
export interface FocusRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Inter-ocular distance (between the midpoints of the eye corners) of the face seen from the front; 0 when landmarks
 * are missing. Turning the head sideways shortens the distance between the eyes in the image, but not the one from
 * the eyes to the mouth, which then stands in. Calibration (FOCUS_HALF's portraits squeezed to 87–34% of their width
 * like heads turned 30–70°, then blurred): sharp eyes score 0.79–0.83 and a 0.1% blur 0.64–0.68 (medians; 0.81 and
 * 0.68 facing the camera), where the eye distance alone gives 0.72–0.78 and 0.29–0.62.
 */
export function interOcularDistance(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < FOCUS_POINT_COUNT) return 0;
  const [left, right] = FOCUS_EYES.map(({ corners: [outer, inner] }) => ({
    x: (points[outer].x + points[inner].x) / 2,
    y: (points[outer].y + points[inner].y) / 2,
  }));
  const lip = points[UPPER_LIP];
  const eyeToLip = Math.hypot(lip.x - (left.x + right.x) / 2, lip.y - (left.y + right.y) / 2);
  return Math.max(Math.hypot(left.x - right.x, left.y - right.y), EYE_LIP_RATIO * eyeToLip);
}

/** Focus regions [subject's left eye, right eye] (see FOCUS_EYES); [] when landmarks are missing. */
export function focusRegions(points: ReadonlyArray<{ x: number; y: number }>): FocusRegion[] {
  if (points.length < FOCUS_POINT_COUNT) return [];
  return FOCUS_EYES.map(({ corners, lowerLid, brow }) => {
    const xs = corners.map((index) => points[index].x);
    const top = Math.min(...[...brow, ...corners].map((index) => points[index].y));
    const bottom = Math.max(...[lowerLid, ...corners].map((index) => points[index].y));
    return { x: Math.min(...xs), y: top, width: Math.max(...xs) - Math.min(...xs), height: bottom - top };
  });
}

/**
 * Focus regions are area-averaged so the eyes are at most this many pixels apart (inter-ocular distance), so a blur
 * reads the same relative to any face at least this large. Calibration: at 48 px a 0.25% blur (of a portrait's long
 * edge) separates less from sharp; at 96–128 px sharp faces vary more with JPEG and resampling.
 */
export const FOCUS_IOD = 64;

/**
 * Faces with eyes closer than this (face-image pixels; eye regions ~6×5 px) are too small to judge focus: below it
 * sharp faces (5th percentile 0.59 at 12 px) start to overlap blurred ones (0.9% blur 0.37 at 12 px).
 */
export const FOCUS_MIN_IOD = 12;

/** Scale for measuring focus (≤ 1, never upscaled); null when the face is too small to judge. */
export function focusScale(interOcular: number): number | null {
  if (!(interOcular >= FOCUS_MIN_IOD)) return null;
  return Math.min(1, FOCUS_IOD / interOcular);
}

/**
 * Laplacian variance of the focus regions at focusScale → 0...1 as v / (v + HALF). Faces smaller than FOCUS_IOD are
 * measured at native size, where the same focus reads a higher variance (sharp eyes ×2 at 32 px, ×4 at 12 px), so
 * HALF grows by FOCUS_IOD / IOD there. Calibration (in the browser: 150 CC0 Congress studio portraits, IOD 92–176 px,
 * and Gaussian blurs with a radius of 0.1 / 0.25 / 0.5 / 0.9% of the long edge): sharp 1653 median → 0.81 (5th / 95th
 * percentile 0.61 / 0.87), blurred 0.68 / 0.26 / 0.05 / 0.02 (medians); the same faces shrunk to 12–48 px read
 * 0.75–0.79 sharp. Sharp scenery scores 0.73 / 0.83 / 0.89 (quartiles of 13 scikit-image samples, core
 * sharpnessScore), so "Sharpest Focus" weighs portraits and scenery alike.
 */
export const FOCUS_HALF = 400;

export function focusScore(laplacianVariance: number, interOcular: number): number {
  if (!Number.isFinite(laplacianVariance) || laplacianVariance <= 0 || !(interOcular > 0)) return 0;
  return laplacianVariance / (laplacianVariance + FOCUS_HALF * Math.max(1, FOCUS_IOD / interOcular));
}

// MARK: - Capture quality

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

/** One eye's landmark geometry. */
export interface EyeShape {
  /** Eye aspect ratio (EAR): mean lid gap / eye width; 0 when landmarks are missing. See EYE_ASPECT_RANGE. */
  aspect: number;
  /** Distance between the eye corners in pixels; 0 when landmarks are missing. */
  width: number;
}

/**
 * EyeShape per eye, [subject's left, subject's right], from landmarks in pixels (x and y must share one scale).
 */
export function eyeShapes(points: ReadonlyArray<{ x: number; y: number }>): [EyeShape, EyeShape] {
  const shape = ([outer, inner, upper1, upper2, lower1, lower2]: readonly number[]): EyeShape => {
    if (points.length <= Math.max(outer, inner, upper1, upper2, lower1, lower2)) return { aspect: 0, width: 0 };
    const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    const width = distance(outer, inner);
    if (!(width > 0)) return { aspect: 0, width: 0 };
    return { aspect: (distance(upper1, lower1) + distance(upper2, lower2)) / (2 * width), width };
  };
  return [shape(EYE_POINTS.left), shape(EYE_POINTS.right)];
}

// Pure photo-level measurements (no DOM; unit tested).

/** Weight of the softest face in the subjects' sharpness; the rest is their mean. */
const SOFTEST_FACE_WEIGHT = 0.6;
/**
 * Faces narrower than this fraction of the largest face are further back than the main subjects (twice as far or
 * more), where a shallow depth of field leaves them soft on purpose, so their focus doesn't count.
 */
export const MAIN_SUBJECT_RATIO = 0.5;

/** A subject face: its focus score (null = too small to judge) and its width in any unit shared by all faces. */
export interface FaceFocus {
  focus: number | null;
  width: number;
}

/**
 * Photo sharpness follows the main subjects: a soft minimum of the focus scores of the faces at least
 * MAIN_SUBJECT_RATIO as wide as the largest, so all of them must be sharp and a sharp background can't make up for
 * soft faces. Without a judgeable main face (scenery, tiny faces) it is the whole image's sharpness and
 * subjectSharpness is null.
 */
export function photoSharpness(
  faces: readonly FaceFocus[],
  wholeSharpness: number,
): { sharpness: number; subjectSharpness: number | null } {
  const largest = Math.max(0, ...faces.map(({ width }) => width));
  const scores = faces
    .filter(({ width }) => width >= MAIN_SUBJECT_RATIO * largest)
    .map(({ focus }) => focus)
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return { sharpness: wholeSharpness, subjectSharpness: null };
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const subjectSharpness = SOFTEST_FACE_WEIGHT * Math.min(...scores) + (1 - SOFTEST_FACE_WEIGHT) * mean;
  return { sharpness: subjectSharpness, subjectSharpness };
}

/** Screen sizes (portrait, px) of iPhones/iPads since 2014; screenshots are saved at exactly these sizes. */
const SCREEN_SIZES = new Set([
  '640x1136', '750x1334', '828x1792', '1080x1920', '1125x2436', '1170x2532', '1179x2556', '1206x2622',
  '1242x2208', '1242x2688', '1284x2778', '1290x2796', '1320x2868', '1080x2340', '1536x2048', '1620x2160',
  '1640x2360', '1668x2224', '1668x2388', '1488x2266', '2048x2732', '2064x2752',
]);

/**
 * Conservative screenshot test: a PNG without an EXIF capture date whose size matches an iPhone/iPad screen.
 * Camera photos are JPEG/HEIC with EXIF, so this doesn't misfire on real shots.
 */
export function isLikelyScreenshot(file: { name: string; type: string }, width: number, height: number, hasCaptureTime: boolean): boolean {
  if (hasCaptureTime) return false;
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  return isPng && SCREEN_SIZES.has(`${Math.min(width, height)}x${Math.max(width, height)}`);
}

// JSON shapes returned by window.photoSortingHarness (web/harness.html). Types only, shared with e2e/harness.
import type { PhotoTimings, FaceDiagnostics } from './analyzer';
import type { DetectFacesStats } from './faces';
import type { TilingOptions } from './tiling';
import type { AnalysisFailure } from './types';

export interface HarnessFace extends Omit<FaceDiagnostics, 'captureQuality'> {
  captureQuality: number | null;
  areaFraction: number;
}

export interface HarnessPhoto {
  name: string;
  order: number;
  width: number;
  height: number;
  capturedAt: number | null;
  isUtility: boolean;
  sharpness: number;
  exposure: number;
  wholeSharpness: number;
  subjectSharpness: number | null;
  faces: HarnessFace[];
  detector: DetectFacesStats & { merged: number; dropped: number };
  timings: PhotoTimings;
  /** Natural size of the decoded thumbnail JPEG. */
  thumbnail: { width: number; height: number };
}

export interface HarnessResult {
  initMs: number;
  totalMs: number;
  photos: HarnessPhoto[];
  failures: AnalysisFailure[];
  cancelled: boolean;
  progressEvents: number;
}

export interface HarnessAnalyzeOptions {
  /** Analyze only the picked files with these names (default: all, in picked order). */
  names?: string[];
  /** Abort after this many progress events. */
  cancelAfter?: number;
  tiling?: TilingOptions;
  /** Upscale each picked file to this size (JPEG) before analysis, to time full-size photos. */
  synthesize?: { width: number; height: number };
}

export interface FaceScaleProbe {
  name: string;
  /** Face width / detector input long edge for each probed scale, and whether a face was found. */
  results: { fraction: number; found: boolean }[];
}

export interface PhotoSortingHarness {
  analyze(options?: HarnessAnalyzeOptions): Promise<HarnessResult>;
  /** core descriptorDistance between two photos of the last analyze() call. */
  distance(nameA: string, nameB: string): number;
  /** Decodes a picked file with createPreviewUrl() and reports the preview's size. */
  preview(name: string, maxEdge?: number): Promise<{ width: number; height: number }>;
  /** Calibration: finds the main face of each picked file and re-detects it pasted at several sizes. */
  probeFaceScale(fractions: number[], canvasSize?: number): Promise<FaceScaleProbe[]>;
}

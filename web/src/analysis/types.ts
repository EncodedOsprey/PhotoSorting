// Contract between the on-device analysis engine (src/analysis) and the UI (src/ui).
import type { FaceMetrics, PhotoMetrics } from '../core/types';

/** Normalized rectangle (0...1), origin top-left, in the displayed (EXIF-oriented) image. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnalyzedFace extends FaceMetrics {
  box: NormalizedBox;
}

export interface AnalyzedPhoto {
  /** Stable identity of the source file: see fileKey(). */
  key: string;
  file: File;
  name: string;
  /** Position in the order the photographer added photos (0-based, assigned by the UI). */
  order: number;
  /** Capture time (EXIF DateTimeOriginal) in ms since epoch; null when unknown. */
  capturedAt: number | null;
  /** Oriented pixel dimensions of the original image. */
  width: number;
  height: number;
  /** Object URL of a small JPEG (~400px long edge). Revoke with releaseAnalyzedPhoto(). */
  thumbnailUrl: string;
  /** Scores used for selection. metrics.faces[i] describes faces[i]. */
  metrics: PhotoMetrics;
  faces: AnalyzedFace[];
  /** Near-duplicate descriptor from core computeDescriptor(). */
  descriptor: Float32Array;
}

export interface AnalysisProgress {
  completed: number;
  total: number;
  failed: number;
  /** The photo that just finished (for a live preview). */
  current?: { name: string; thumbnailUrl?: string };
}

export interface AnalysisFailure {
  key: string;
  name: string;
  /** Short user-facing reason, e.g. "Unsupported image format". */
  reason: string;
}

export interface AnalysisOutcome {
  /** Successfully analyzed photos, in the order of the input array. */
  photos: AnalyzedPhoto[];
  failures: AnalysisFailure[];
  /** True if options.signal aborted; photos/failures hold whatever finished first. */
  cancelled: boolean;
}

export interface AnalyzeOptions {
  onProgress?: (progress: AnalysisProgress) => void;
  signal?: AbortSignal;
}

export interface PhotoAnalyzer {
  /** Loads the WASM runtime and models. Idempotent. Rejects with a user-presentable Error on failure. */
  init(): Promise<void>;
  /**
   * Analyzes the files (initializing first if needed). Per-file problems are reported in
   * `failures` and never reject; the promise rejects only if the models cannot be loaded.
   */
  analyze(files: ReadonlyArray<{ file: File; order: number }>, options?: AnalyzeOptions): Promise<AnalysisOutcome>;
  /** Frees model resources. */
  close(): void;
}

/*
 * Functions implemented in src/analysis:
 *
 *   analyzer.ts  createPhotoAnalyzer(): PhotoAnalyzer
 *   files.ts     fileKey(file: File): string                     `${name}|${size}|${lastModified}`
 *                isProbablyImage(file: File): boolean            by MIME type / extension (jpg, jpeg, png, heic, heif, webp, gif, avif, tif, tiff)
 *                releaseAnalyzedPhoto(photo: AnalyzedPhoto): void  revokes thumbnailUrl
 *   preview.ts   createPreviewUrl(file: File, maxEdge = 1600): Promise<string>
 *                  decodes the original with EXIF orientation applied and returns an object URL of a
 *                  downscaled JPEG for the detail view (caller revokes it).
 */

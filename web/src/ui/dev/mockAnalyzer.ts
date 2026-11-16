// Development-only stand-in for the analysis engine, used with `?mock=1` on the Vite dev server (see
// analyzerFactory.ts). It decodes the real files for thumbnails and near-duplicate descriptors but invents the
// face and quality scores. Options: mockDelay (ms per photo), mockInit (ms to "load"), mockEngineError=1.
import { fileKey } from '../../analysis/files';
import type { AnalysisOutcome, AnalyzedFace, AnalyzedPhoto, PhotoAnalyzer } from '../../analysis/types';
import { computeDescriptor } from '../../core';

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    });
  });

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas');
  return [element, context];
}

function inventFaces(rnd: () => number, aspect: number): AnalyzedFace[] {
  const count = [0, 0, 1, 1, 1, 2, 2, 3, 4, 6][Math.floor(rnd() * 10)];
  return Array.from({ length: count }, (_, index) => {
    const areaFraction = count <= 2 ? 0.03 + rnd() * 0.12 : 0.004 + rnd() * 0.02;
    const width = Math.min(0.9, Math.sqrt(areaFraction / aspect));
    const height = Math.min(0.9, areaFraction / width);
    const slot = (index + 0.5) / count;
    return {
      smile: rnd() < 0.15 ? rnd() * 0.2 : 0.3 + rnd() * 0.7,
      eyesOpen: rnd() < 0.12 ? rnd() * 0.25 : 0.65 + rnd() * 0.35,
      captureQuality: 0.4 + rnd() * 0.6,
      areaFraction,
      box: {
        x: Math.max(0, Math.min(1 - width, slot - width / 2 + (rnd() - 0.5) * 0.05)),
        y: Math.max(0, Math.min(1 - height, 0.2 + rnd() * 0.3)),
        width,
        height,
      },
    };
  });
}

async function analyzeFile(file: File, order: number): Promise<AnalyzedPhoto> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, 400 / Math.max(width, height));
  const [thumb, thumbContext] = canvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  thumbContext.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
  const [, smallContext] = canvas(32, 32);
  smallContext.drawImage(bitmap, 0, 0, 32, 32);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    thumb.toBlob((result) => (result ? resolve(result) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', 0.82),
  );
  const pixels = smallContext.getImageData(0, 0, 32, 32).data;
  const rnd = random(hash(file.name));
  const faces = inventFaces(rnd, width / height);
  return {
    key: fileKey(file),
    file,
    name: file.name,
    order,
    capturedAt: file.lastModified || null,
    width,
    height,
    thumbnailUrl: URL.createObjectURL(blob),
    metrics: {
      faces: faces.map(({ smile, eyesOpen, captureQuality, areaFraction }) => ({ smile, eyesOpen, captureQuality, areaFraction })),
      sharpness: rnd() < 0.12 ? rnd() * 0.25 : 0.35 + rnd() * 0.65,
      exposure: 0.35 + rnd() * 0.65,
      aesthetics: null,
      isUtility: false,
    },
    faces,
    descriptor: computeDescriptor(pixels, 32, 32),
  };
}

export function createMockAnalyzer(params: URLSearchParams): PhotoAnalyzer {
  const delay = Number(params.get('mockDelay') ?? 250);
  const initDelay = Number(params.get('mockInit') ?? 1500);
  const failInit = params.get('mockEngineError') === '1';
  let loaded: Promise<void> | null = null;

  const init = () => {
    loaded ??= sleep(initDelay).then(() => {
      if (failInit) {
        loaded = null;
        throw new Error("Couldn't load the photo analysis engine. Check your connection and try again.");
      }
    });
    return loaded;
  };

  return {
    init,
    async analyze(files, { onProgress, signal } = {}) {
      await init();
      const outcome: AnalysisOutcome = { photos: [], failures: [], cancelled: false };
      for (let index = 0; index < files.length; index++) {
        await sleep(delay, signal);
        if (signal?.aborted) {
          outcome.cancelled = true;
          break;
        }
        const { file, order } = files[index];
        let current: { name: string; thumbnailUrl?: string } = { name: file.name };
        try {
          const photo = await analyzeFile(file, order);
          outcome.photos.push(photo);
          current = { name: photo.name, thumbnailUrl: photo.thumbnailUrl };
        } catch {
          outcome.failures.push({ key: fileKey(file), name: file.name, reason: "This image format can't be opened in this browser" });
        }
        onProgress?.({ completed: index + 1, total: files.length, failed: outcome.failures.length, current });
      }
      return outcome;
    },
    close() {
      loaded = null;
    },
  };
}

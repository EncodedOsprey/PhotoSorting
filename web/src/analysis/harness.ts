// Dev-only test harness for the analysis engine (served by `npm run dev` at /harness.html; not in the
// production build). Playwright drives it via window.photoSortingHarness — see e2e/harness/analysis.spec.ts.
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { descriptorDistance } from '../core';
import { createPhotoAnalyzer, type PhotoDiagnostics } from './analyzer';
import { createCanvas, fitWithin, Resampler } from './canvas';
import { decodeImage } from './decode';
import { loadFaceLandmarker } from './faces';
import { releaseAnalyzedPhoto } from './files';
import type {
  FaceScaleProbe,
  HarnessAnalyzeOptions,
  HarnessPhoto,
  HarnessResult,
  PhotoSortingHarness,
} from './harnessTypes';
import { createPreviewUrl } from './preview';
import { boxFromTilePoints } from './tiling';
import type { AnalyzedPhoto, PhotoAnalyzer } from './types';

declare global {
  interface Window {
    photoSortingHarness: PhotoSortingHarness;
  }
}

const input = document.querySelector<HTMLInputElement>('#files')!;
const log = document.querySelector<HTMLPreElement>('#log')!;
const diagnostics = new Map<string, PhotoDiagnostics>();
const analyzers = new Map<string, PhotoAnalyzer>();
let lastPhotos: AnalyzedPhoto[] = [];

function analyzerFor(options: HarnessAnalyzeOptions): PhotoAnalyzer {
  const id = JSON.stringify(options.tiling ?? null);
  let analyzer = analyzers.get(id);
  if (!analyzer) {
    analyzer = createPhotoAnalyzer({
      tiling: options.tiling,
      onDiagnostics: (photo) => diagnostics.set(photo.key, photo),
    });
    analyzers.set(id, analyzer);
  }
  return analyzer;
}

function pickedFiles(names?: string[]): File[] {
  const files = Array.from(input.files ?? []);
  if (!names) return files;
  return names.map((name) => {
    const file = files.find((candidate) => candidate.name === name);
    if (!file) throw new Error(`No picked file named ${name}`);
    return file;
  });
}

async function imageSize(url: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/** Upscales a file to width×height (JPEG q0.9) to time full-size photos with real content. */
async function synthesize(file: File, width: number, height: number): Promise<File> {
  const decoded = await decodeImage(file);
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(decoded.image, 0, 0, width, height);
  decoded.release();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  canvas.width = 0;
  canvas.height = 0;
  return new File([blob!], `${file.name.replace(/\.\w+$/, '')}-${width}x${height}.jpg`, { type: 'image/jpeg' });
}

async function summarize(photo: AnalyzedPhoto): Promise<HarnessPhoto> {
  const diag = diagnostics.get(photo.key);
  if (!diag) throw new Error(`No diagnostics for ${photo.name}`);
  return {
    name: photo.name,
    order: photo.order,
    width: photo.width,
    height: photo.height,
    capturedAt: photo.capturedAt,
    isUtility: photo.metrics.isUtility,
    sharpness: photo.metrics.sharpness,
    exposure: photo.metrics.exposure,
    wholeSharpness: diag.wholeSharpness,
    subjectSharpness: diag.subjectSharpness,
    faces: photo.faces.map((face, index) => ({
      ...diag.faces[index],
      box: face.box,
      captureQuality: face.captureQuality,
      areaFraction: face.areaFraction,
    })),
    detector: diag.detector,
    timings: diag.timings,
    thumbnail: await imageSize(photo.thumbnailUrl),
  };
}

const harness: PhotoSortingHarness = {
  async analyze(options = {}) {
    let files = pickedFiles(options.names);
    if (options.synthesize) {
      const { width, height } = options.synthesize;
      files = await Promise.all(files.map((file) => synthesize(file, width, height)));
    }
    const analyzer = analyzerFor(options);
    const initStart = performance.now();
    await analyzer.init();
    const initMs = performance.now() - initStart;

    const controller = new AbortController();
    let progressEvents = 0;
    const start = performance.now();
    const outcome = await analyzer.analyze(
      files.map((file, order) => ({ file, order })),
      {
        signal: controller.signal,
        onProgress: () => {
          progressEvents += 1;
          if (options.cancelAfter !== undefined && progressEvents >= options.cancelAfter) controller.abort();
        },
      },
    );
    const totalMs = performance.now() - start;

    lastPhotos.forEach(releaseAnalyzedPhoto);
    lastPhotos = outcome.photos;
    const result: HarnessResult = {
      initMs,
      totalMs,
      photos: await Promise.all(outcome.photos.map(summarize)),
      failures: outcome.failures,
      cancelled: outcome.cancelled,
      progressEvents,
    };
    log.textContent = JSON.stringify(result, null, 1);
    return result;
  },

  distance(nameA, nameB) {
    const find = (name: string) => {
      const photo = lastPhotos.find((candidate) => candidate.name === name);
      if (!photo) throw new Error(`${name} was not analyzed`);
      return photo;
    };
    return descriptorDistance(find(nameA).descriptor, find(nameB).descriptor);
  },

  async preview(name, maxEdge) {
    const url = await createPreviewUrl(pickedFiles([name])[0], maxEdge);
    try {
      return await imageSize(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  async probeFaceScale(fractions, canvasSize = 512) {
    const landmarker = await loadFaceLandmarker();
    try {
      const probes: FaceScaleProbe[] = [];
      for (const file of pickedFiles()) probes.push(await probeFile(landmarker, file, fractions, canvasSize));
      return probes;
    } finally {
      landmarker.close();
    }
  },
};

/** Pastes the file's main face (with context) onto a gray square so its width is `fraction` of the square. */
async function probeFile(landmarker: FaceLandmarker, file: File, fractions: number[], canvasSize: number): Promise<FaceScaleProbe> {
  const decoded = await decodeImage(file);
  const source = createCanvas();
  const size = fitWithin(decoded.width, decoded.height, 1024);
  new Resampler().draw(decoded.image, { x: 0, y: 0, width: decoded.width, height: decoded.height }, source, size.width, size.height);
  decoded.release();
  const result = landmarker.detect(source);
  const results: FaceScaleProbe['results'] = [];
  if (result.faceLandmarks.length > 0) {
    const face = boxFromTilePoints(result.faceLandmarks[0], { x: 0, y: 0, width: size.width, height: size.height });
    // Face plus half a face of context on each side (hair, shoulders), as in a real photo.
    const crop = { x: face.x - face.width / 2, y: face.y - face.height / 2, width: face.width * 2, height: face.height * 2 };
    const canvas = createCanvas();
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const context = canvas.getContext('2d')!;
    for (const fraction of fractions) {
      context.fillStyle = '#7a7a7a';
      context.fillRect(0, 0, canvasSize, canvasSize);
      const scale = (fraction * canvasSize) / face.width;
      const width = crop.width * scale;
      const height = crop.height * scale;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, crop.x, crop.y, crop.width, crop.height, (canvasSize - width) / 2, (canvasSize - height) / 2, width, height);
      results.push({ fraction, found: landmarker.detect(canvas).faceLandmarks.length > 0 });
    }
  }
  return { name: file.name, results };
}

window.photoSortingHarness = harness;
document.body.dataset.ready = 'true';

// Manual use: pick files, press Analyze; the JSON result is printed below.
document.querySelector<HTMLButtonElement>('#analyze')!.addEventListener('click', () => {
  log.textContent = 'Analyzing…';
  harness.analyze().catch((error: unknown) => {
    log.textContent = String(error);
  });
});

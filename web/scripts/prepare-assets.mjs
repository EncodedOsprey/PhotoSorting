// Puts the on-device analysis assets into public/mediapipe/ (git-ignored):
//  - MediaPipe Tasks Vision WASM runtime, copied from node_modules.
//  - Google's Face Landmarker model, downloaded and verified against a pinned SHA-256.
//
// Options (environment variables):
//   FACE_MODEL_PATH=/path/face_landmarker.task  use a local copy instead of downloading (still hash-checked)
//   FORCE_MODEL_DOWNLOAD=1                      always re-download from Google (CI uses this to verify the pin)
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrcDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmFiles = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const modelPath = join(outDir, 'face_landmarker.task');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  await mkdir(join(outDir, 'wasm'), { recursive: true });
  for (const name of wasmFiles) {
    const src = join(wasmSrcDir, name);
    const dest = join(outDir, 'wasm', name);
    const [s, d] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
    if (!d || d.size !== s.size || d.mtimeMs < s.mtimeMs) await copyFile(src, dest);
  }
}

async function ensureModel() {
  const force = process.env.FORCE_MODEL_DOWNLOAD === '1';
  if (!force && (await exists(modelPath)) && sha256(await readFile(modelPath)) === MODEL_SHA256) return 'cached';

  let bytes;
  let source;
  if (process.env.FACE_MODEL_PATH && !force) {
    source = process.env.FACE_MODEL_PATH;
    bytes = await readFile(source);
  } else {
    source = MODEL_URL;
    let response;
    try {
      response = await fetch(MODEL_URL);
    } catch (error) {
      throw new Error(`Could not download the face model from ${MODEL_URL}: ${error.message}. ` +
        'Set FACE_MODEL_PATH to a local copy of face_landmarker.task to work offline.');
    }
    if (!response.ok) {
      throw new Error(`Downloading the face model failed with HTTP ${response.status} (${MODEL_URL}). ` +
        'Set FACE_MODEL_PATH to a local copy of face_landmarker.task to work offline.');
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }

  const actual = sha256(bytes);
  if (actual !== MODEL_SHA256) {
    throw new Error(`Face model from ${source} has SHA-256 ${actual}, expected ${MODEL_SHA256}.`);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(modelPath, bytes);
  return source;
}

await copyWasm();
const modelSource = await ensureModel();
console.log(`MediaPipe assets ready in public/mediapipe (model: ${modelSource}).`);

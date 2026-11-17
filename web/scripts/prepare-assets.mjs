// Puts the on-device analysis assets into public/ (git-ignored):
//  - public/mediapipe/: the MediaPipe Tasks Vision WASM runtime, copied from node_modules, and Google's Face
//    Landmarker model.
//  - public/models/: the eye-state (OCEC) and sunglasses (SGC) classifiers by PINTO0309 (MIT, see LICENSE.txt there).
// Models are downloaded and verified against pinned SHA-256 hashes.
//
// Options (environment variables):
//   FACE_MODEL_PATH=/path/face_landmarker.task  use a local copy instead of downloading (still hash-checked);
//   EYE_MODEL_PATH, SUNGLASSES_MODEL_PATH       likewise for ocec_s.onnx and sgc_s.onnx
//   FORCE_MODEL_DOWNLOAD=1                      always re-download (CI uses this to verify the pins)
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const modelsDir = join(root, 'public', 'models');
const wasmSrcDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmFiles = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';

const MODELS = [
  {
    name: 'face model',
    url: MODEL_URL,
    sha256: MODEL_SHA256,
    path: join(outDir, 'face_landmarker.task'),
    localEnv: 'FACE_MODEL_PATH',
  },
  {
    name: 'eye-state model',
    url: 'https://github.com/PINTO0309/OCEC/releases/download/onnx/ocec_s.onnx',
    sha256: '9a346a08b256ad70725044cd2aa582858e108c6f45d42a9c3415afc604ba9b64',
    path: join(modelsDir, 'ocec_s.onnx'),
    localEnv: 'EYE_MODEL_PATH',
  },
  {
    name: 'sunglasses model',
    url: 'https://github.com/PINTO0309/SGC/releases/download/onnx/sgc_is_s_48x48.onnx',
    sha256: '005daa03aaa0f7120d94300e1115633cd886f7846e4321af11854bfd880873da',
    path: join(modelsDir, 'sgc_s.onnx'),
    localEnv: 'SUNGLASSES_MODEL_PATH',
  },
];

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

async function ensureModel({ name, url, sha256: expected, path, localEnv }) {
  const force = process.env.FORCE_MODEL_DOWNLOAD === '1';
  if (!force && (await exists(path)) && sha256(await readFile(path)) === expected) return 'cached';

  const offlineHint = `Set ${localEnv} to a local copy to work offline.`;
  let bytes;
  let source;
  if (process.env[localEnv] && !force) {
    source = process.env[localEnv];
    bytes = await readFile(source);
  } else {
    source = url;
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(`Could not download the ${name} from ${url}: ${error.message}. ${offlineHint}`);
    }
    if (!response.ok) {
      throw new Error(`Downloading the ${name} failed with HTTP ${response.status} (${url}). ${offlineHint}`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }

  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`The ${name} from ${source} has SHA-256 ${actual}, expected ${expected}.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return source;
}

await copyWasm();
for (const model of MODELS) {
  const source = await ensureModel(model);
  console.log(`${model.name[0].toUpperCase()}${model.name.slice(1)} ready (${source}).`);
}
console.log('Analysis assets ready in public/mediapipe and public/models.');

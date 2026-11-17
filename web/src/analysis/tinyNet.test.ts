import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TinyNet } from './tinyNet';

const MODELS_DIR = join(__dirname, '..', '..', 'public', 'models');
const present = ['ocec_s.onnx', 'sgc_s.onnx'].every((name) => existsSync(join(MODELS_DIR, name)));
if (!present && process.env.CI) throw new Error('public/models is missing: run `npm run prepare-assets` first');
if (!present) console.warn('Skipping the eye-model parity tests: run `npm run prepare-assets` to download the models');

/** Deterministic test input in [0, 1] (the same formula generated the onnxruntime reference outputs). */
function pattern(length: number, seed: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => ((i * 7919 + seed * 104729) % 1009) / 1008);
}

/** Smooth RGB gradient: red follows x, green y, blue their mean. */
function gradient(height: number, width: number): Float32Array {
  const data = new Float32Array(3 * height * width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const v = y / (height - 1);
      const i = y * width + x;
      data[i] = u;
      data[height * width + i] = v;
      data[2 * height * width + i] = (u + v) / 2;
    }
  }
  return data;
}

describe.skipIf(!present)('TinyNet matches onnxruntime 1.32 (CPU) on the shipped models', () => {
  it.each([
    // Reference outputs: onnxruntime InferenceSession.run on the same inputs (patterns with seeds 0, 1, 2, gradient).
    { file: 'ocec_s.onnx', shape: [3, 24, 40], expected: [0.805737, 0.97995, 0.748635, 0.061053] },
    { file: 'sgc_s.onnx', shape: [3, 48, 48], expected: [0.1416, 0.037202, 0.08418, 0.324283] },
  ])('$file', ({ file, shape, expected }) => {
    const net = TinyNet.fromOnnx(readFileSync(join(MODELS_DIR, file)));
    expect(net.inputShape).toEqual(shape);
    const [channels, height, width] = shape;
    const size = channels * height * width;
    const inputs = [pattern(size, 0), pattern(size, 1), pattern(size, 2), gradient(height, width)];
    const outputs = inputs.map((input) => net.run(input));
    for (const output of outputs) expect(output).toHaveLength(1);
    outputs.forEach((output, i) => expect(output[0]).toBeCloseTo(expected[i], 4));
    // Buffers are reused between runs: running again gives the same answer.
    expect(net.run(inputs[0])[0]).toBe(outputs[0][0]);
  });

  it('rejects an input of the wrong size', () => {
    const net = TinyNet.fromOnnx(readFileSync(join(MODELS_DIR, 'ocec_s.onnx')));
    expect(() => net.run(new Float32Array(10))).toThrow(RangeError);
  });
});

// A small CPU interpreter for the eye-state and sunglasses classifiers: ONNX graphs of convolutions, activations,
// pooling and dense layers, run on one image (batch 1) in float32. Shapes are fixed when a model is loaded, so runs
// reuse the same buffers, and each convolution is fused with the activation that follows it (SiLU appears in the
// graphs as x · sigmoid(x)). Only the operators those graphs use are supported; anything else fails at load time.
import { parseOnnx, type OnnxAttribute, type OnnxGraph, type OnnxNode, type OnnxTensor } from './onnx';

type Activation = 'none' | 'relu' | 'sigmoid' | 'silu';

interface Value {
  shape: number[];
  data: Float32Array;
}

const product = (shape: readonly number[]): number => shape.reduce((total, size) => total * size, 1);

export class TinyNet {
  /** Input shape without the batch dimension, e.g. [3, 24, 40] (channels, height, width). */
  readonly inputShape: readonly number[];
  private readonly input: Float32Array;
  private readonly output: Value;
  private readonly steps: Array<() => void> = [];

  static fromOnnx(bytes: Uint8Array): TinyNet {
    return new TinyNet(parseOnnx(bytes));
  }

  constructor(graph: OnnxGraph) {
    if (graph.inputs.length !== 1 || graph.outputs.length !== 1) throw new Error('Expected one input and one output');
    const [inputInfo] = graph.inputs;
    const inputShape = inputInfo.shape.map((size, axis) => (axis === 0 ? 1 : size));
    if (inputShape.length < 2 || inputShape.some((size) => !(size > 0))) {
      throw new Error(`Unsupported input shape ${inputInfo.shape.join('×')}`);
    }
    this.inputShape = inputShape.slice(1);
    this.input = new Float32Array(product(inputShape));

    const values = new Map<string, Value>([[inputInfo.name, { shape: inputShape, data: this.input }]]);
    const constants = new Map<string, OnnxTensor>(graph.initializers);
    const value = (name: string): Value => {
      const known = values.get(name);
      if (known) return known;
      const constant = constants.get(name);
      if (constant?.data instanceof Float32Array) {
        const tensor = { shape: constant.dims, data: constant.data };
        values.set(name, tensor);
        return tensor;
      }
      throw new Error(`Unknown float tensor ${name}`);
    };
    const integers = (name: string): number[] => {
      const constant = constants.get(name);
      if (!constant || constant.data instanceof Float32Array) throw new Error(`Expected an integer constant: ${name}`);
      return constant.data;
    };

    for (const node of fuseActivations(graph.nodes, graph.outputs[0].name)) {
      if (node.opType === 'Constant') {
        const tensor = node.attributes.value;
        if (!isTensor(tensor)) throw new Error('Constant without a tensor value');
        constants.set(node.outputs[0], tensor);
        continue;
      }
      const { output, step } = compile(node, value, integers, graph.opset);
      values.set(node.outputs[0], output);
      if (step) this.steps.push(step);
    }
    this.output = value(graph.outputs[0].name);
  }

  /** Runs the network on one input (channels × height × width, float32) and returns a copy of the output. */
  run(input: Float32Array): Float32Array {
    if (input.length !== this.input.length) {
      throw new RangeError(`Expected ${this.input.length} input values, got ${input.length}`);
    }
    this.input.set(input);
    for (const step of this.steps) step();
    return this.output.data.slice();
  }
}

function isTensor(attribute: OnnxAttribute | undefined): attribute is OnnxTensor {
  return typeof attribute === 'object' && !Array.isArray(attribute);
}

function intAttribute(node: OnnxNode, name: string, fallback: number): number {
  const attribute = node.attributes[name];
  return typeof attribute === 'number' ? attribute : fallback;
}

function intsAttribute(node: OnnxNode, name: string, fallback: number[]): number[] {
  const attribute = node.attributes[name];
  return Array.isArray(attribute) ? attribute : fallback;
}

/**
 * Rewrites x · sigmoid(x) as one SiLU node, then folds a Relu/Sigmoid/SiLU into the Conv before it when that Conv's
 * output feeds nothing else.
 */
function fuseActivations(nodes: readonly OnnxNode[], graphOutput: string): OnnxNode[] {
  const consumersOf = (list: readonly OnnxNode[]) => {
    const consumers = new Map<string, OnnxNode[]>();
    for (const node of list) {
      for (const input of node.inputs) consumers.set(input, [...(consumers.get(input) ?? []), node]);
    }
    return consumers;
  };

  let consumers = consumersOf(nodes);
  const removed = new Set<OnnxNode>();
  const withSilu = nodes.map((node) => {
    if (node.opType !== 'Sigmoid' || node.outputs[0] === graphOutput) return node;
    const [x] = node.inputs;
    const users = consumers.get(node.outputs[0]) ?? [];
    const mul = users[0];
    if (users.length !== 1 || mul.opType !== 'Mul' || mul.inputs.length !== 2) return node;
    if (!mul.inputs.includes(x) || !mul.inputs.includes(node.outputs[0])) return node;
    removed.add(mul);
    return { opType: 'SiLU', inputs: [x], outputs: mul.outputs, attributes: {} };
  });
  const siluNodes = withSilu.filter((node) => !removed.has(node));

  consumers = consumersOf(siluNodes);
  removed.clear();
  const fused = siluNodes.map((node) => {
    if (node.opType !== 'Conv' || node.outputs[0] === graphOutput) return node;
    const users = consumers.get(node.outputs[0]) ?? [];
    const activation = users[0];
    if (users.length !== 1 || !['Relu', 'Sigmoid', 'SiLU'].includes(activation.opType)) return node;
    removed.add(activation);
    return {
      ...node,
      outputs: activation.outputs,
      attributes: { ...node.attributes, activation: activation.opType.toLowerCase() },
    };
  });
  return fused.filter((node) => !removed.has(node));
}

function compile(
  node: OnnxNode,
  value: (name: string) => Value,
  integers: (name: string) => number[],
  opset: number,
): { output: Value; step: (() => void) | null } {
  const input = (index: number): Value => value(node.inputs[index]);
  switch (node.opType) {
    case 'Conv':
      return compileConv(node, input(0), input(1), node.inputs[2] ? input(2) : null);
    case 'Relu':
    case 'Sigmoid':
    case 'SiLU': {
      const x = input(0);
      const output = { shape: x.shape, data: new Float32Array(x.data.length) };
      const activation = node.opType.toLowerCase() as Activation;
      return {
        output,
        step: () => {
          output.data.set(x.data);
          activate(output.data, activation);
        },
      };
    }
    case 'Add':
    case 'Mul':
      return compileBinary(node.opType, input(0), input(1));
    case 'GlobalAveragePool': {
      const x = input(0);
      return compileReduce(x, x.shape.length - 2, true, 'mean');
    }
    case 'ReduceMean':
    case 'ReduceMax': {
      const x = input(0);
      // Opset 18 moved the axes from an attribute to an optional input.
      const axes = opset >= 18 && node.inputs[1] ? integers(node.inputs[1]) : intsAttribute(node, 'axes', []);
      const rank = x.shape.length;
      const normalized = (axes.length > 0 ? axes : x.shape.map((_, axis) => axis))
        .map((axis) => (axis < 0 ? axis + rank : axis))
        .sort((a, b) => a - b);
      const first = normalized[0];
      if (normalized.some((axis, index) => axis !== first + index) || normalized[normalized.length - 1] !== rank - 1) {
        throw new Error(`${node.opType} is only supported over trailing axes`);
      }
      return compileReduce(x, normalized.length, intAttribute(node, 'keepdims', 1) === 1, node.opType === 'ReduceMax' ? 'max' : 'mean');
    }
    case 'Concat':
      return compileConcat(node.inputs.map((_, index) => input(index)), intAttribute(node, 'axis', 0));
    case 'Gemm':
      return compileGemm(node, input(0), input(1), node.inputs[2] ? input(2) : null);
    case 'Squeeze': {
      const x = input(0);
      const rank = x.shape.length;
      const axes = (opset >= 13 ? (node.inputs[1] ? integers(node.inputs[1]) : []) : intsAttribute(node, 'axes', [])).map(
        (axis) => (axis < 0 ? axis + rank : axis),
      );
      const shape = x.shape.filter((size, axis) => (axes.length > 0 ? !axes.includes(axis) : size !== 1));
      if (product(shape) !== x.data.length) throw new Error('Squeeze of a dimension larger than 1');
      return { output: { shape, data: x.data }, step: null };
    }
    default:
      throw new Error(`Unsupported ONNX operator ${node.opType}`);
  }
}

function activate(data: Float32Array, activation: Activation): void {
  const n = data.length;
  if (activation === 'relu') {
    for (let i = 0; i < n; i++) if (data[i] < 0) data[i] = 0;
  } else if (activation === 'sigmoid') {
    for (let i = 0; i < n; i++) data[i] = 1 / (1 + Math.exp(-data[i]));
  } else if (activation === 'silu') {
    for (let i = 0; i < n; i++) {
      const v = data[i];
      data[i] = v / (1 + Math.exp(-v));
    }
  }
}

function compileConv(node: OnnxNode, x: Value, w: Value, b: Value | null): { output: Value; step: () => void } {
  const [batch, channels, height, width] = x.shape;
  const [outChannels, groupChannels, kernelH, kernelW] = w.shape;
  const group = intAttribute(node, 'group', 1);
  const [strideH, strideW] = intsAttribute(node, 'strides', [1, 1]);
  const [padTop, padLeft, padBottom, padRight] = intsAttribute(node, 'pads', [0, 0, 0, 0]);
  const autoPad = node.attributes.auto_pad;
  if (
    x.shape.length !== 4 ||
    w.shape.length !== 4 ||
    batch !== 1 ||
    groupChannels * group !== channels ||
    outChannels % group !== 0 ||
    intsAttribute(node, 'dilations', [1, 1]).some((dilation) => dilation !== 1) ||
    (autoPad !== undefined && autoPad !== 'NOTSET')
  ) {
    throw new Error(`Unsupported Conv ${x.shape.join('×')} * ${w.shape.join('×')}`);
  }
  const outH = Math.floor((height + padTop + padBottom - kernelH) / strideH) + 1;
  const outW = Math.floor((width + padLeft + padRight - kernelW) / strideW) + 1;
  const output = { shape: [1, outChannels, outH, outW], data: new Float32Array(outChannels * outH * outW) };
  const activation = (node.attributes.activation ?? 'none') as Activation;
  const bias = b?.data ?? null;
  const geometry: ConvGeometry = { outChannels, outH, outW, kernelH, kernelW, strideH, strideW, padTop, padLeft, group };
  const input = { channels, height, width };
  const pointwise = kernelH === 1 && kernelW === 1 && strideH === 1 && strideW === 1;
  const unpadded = padTop === 0 && padLeft === 0 && padBottom === 0 && padRight === 0;
  let step: () => void;
  if (group === 1 && pointwise && unpadded) {
    step = () => pointwiseConv(x.data, channels, height * width, w.data, bias, outChannels, output.data);
  } else if (group === 1) {
    // Unfold the input patches into a matrix once, then the convolution is the same product as a 1×1 conv.
    const columns = new Float32Array(channels * kernelH * kernelW * outH * outW);
    step = () => {
      im2col(x.data, input, geometry, columns);
      pointwiseConv(columns, channels * kernelH * kernelW, outH * outW, w.data, bias, outChannels, output.data);
    };
  } else if (group === channels && outChannels === channels && kernelH === 3 && kernelW === 3) {
    step = () => depthwiseConv3x3(x.data, input, w.data, bias, geometry, output.data);
  } else {
    step = () => conv2d(x.data, input, w.data, bias, geometry, output.data);
  }
  return {
    output,
    step: () => {
      step();
      activate(output.data, activation);
    },
  };
}

/**
 * 1×1 convolution, i.e. the matrix product [outChannels, channels] × [channels, size]. Each pass accumulates a block of
 * four output channels × two pixels in locals, so every weight and input value loaded is used twice or four times.
 */
function pointwiseConv(
  x: Float32Array,
  channels: number,
  size: number,
  w: Float32Array,
  bias: Float32Array | null,
  outChannels: number,
  out: Float32Array,
): void {
  let co = 0;
  for (; co + 4 <= outChannels; co += 4) {
    const w0 = co * channels;
    const w1 = w0 + channels;
    const w2 = w1 + channels;
    const w3 = w2 + channels;
    const o0 = co * size;
    const o1 = o0 + size;
    const o2 = o1 + size;
    const o3 = o2 + size;
    const b0 = bias ? bias[co] : 0;
    const b1 = bias ? bias[co + 1] : 0;
    const b2 = bias ? bias[co + 2] : 0;
    const b3 = bias ? bias[co + 3] : 0;
    let p = 0;
    for (; p + 2 <= size; p += 2) {
      let s0 = b0;
      let s1 = b1;
      let s2 = b2;
      let s3 = b3;
      let t0 = b0;
      let t1 = b1;
      let t2 = b2;
      let t3 = b3;
      for (let ci = 0, i = p; ci < channels; ci++, i += size) {
        const u = x[i];
        const v = x[i + 1];
        const a0 = w[w0 + ci];
        const a1 = w[w1 + ci];
        const a2 = w[w2 + ci];
        const a3 = w[w3 + ci];
        s0 += a0 * u;
        t0 += a0 * v;
        s1 += a1 * u;
        t1 += a1 * v;
        s2 += a2 * u;
        t2 += a2 * v;
        s3 += a3 * u;
        t3 += a3 * v;
      }
      out[o0 + p] = s0;
      out[o0 + p + 1] = t0;
      out[o1 + p] = s1;
      out[o1 + p + 1] = t1;
      out[o2 + p] = s2;
      out[o2 + p + 1] = t2;
      out[o3 + p] = s3;
      out[o3 + p + 1] = t3;
    }
    for (; p < size; p++) {
      let s0 = b0;
      let s1 = b1;
      let s2 = b2;
      let s3 = b3;
      for (let ci = 0, i = p; ci < channels; ci++, i += size) {
        const u = x[i];
        s0 += w[w0 + ci] * u;
        s1 += w[w1 + ci] * u;
        s2 += w[w2 + ci] * u;
        s3 += w[w3 + ci] * u;
      }
      out[o0 + p] = s0;
      out[o1 + p] = s1;
      out[o2 + p] = s2;
      out[o3 + p] = s3;
    }
  }
  for (; co < outChannels; co++) {
    const w0 = co * channels;
    const b0 = bias ? bias[co] : 0;
    for (let p = 0; p < size; p++) {
      let sum = b0;
      for (let ci = 0, i = p; ci < channels; ci++, i += size) sum += w[w0 + ci] * x[i];
      out[co * size + p] = sum;
    }
  }
}

interface ConvGeometry {
  outChannels: number;
  outH: number;
  outW: number;
  kernelH: number;
  kernelW: number;
  strideH: number;
  strideW: number;
  padTop: number;
  padLeft: number;
  group: number;
}

/** Grouped, strided, zero-padded convolution: each kernel tap adds a weighted, shifted row of the input. */
function conv2d(
  x: Float32Array,
  { channels, height, width }: { channels: number; height: number; width: number },
  w: Float32Array,
  bias: Float32Array | null,
  { outChannels, outH, outW, kernelH, kernelW, strideH, strideW, padTop, padLeft, group }: ConvGeometry,
  out: Float32Array,
): void {
  const groupChannels = channels / group;
  const groupOutChannels = outChannels / group;
  const outSize = outH * outW;
  for (let co = 0; co < outChannels; co++) {
    const outBase = co * outSize;
    out.fill(bias ? bias[co] : 0, outBase, outBase + outSize);
    const firstChannel = Math.floor(co / groupOutChannels) * groupChannels;
    for (let c = 0; c < groupChannels; c++) {
      const inBase = (firstChannel + c) * height * width;
      for (let ky = 0; ky < kernelH; ky++) {
        for (let kx = 0; kx < kernelW; kx++) {
          const weight = w[((co * groupChannels + c) * kernelH + ky) * kernelW + kx];
          // Output columns whose input column (ox · strideW − padLeft + kx) lies inside the image.
          const oxStart = Math.max(0, Math.ceil((padLeft - kx) / strideW));
          const oxEnd = Math.min(outW, Math.floor((width - 1 + padLeft - kx) / strideW) + 1);
          for (let oy = 0; oy < outH; oy++) {
            const iy = oy * strideH - padTop + ky;
            if (iy < 0 || iy >= height) continue;
            const inRow = inBase + iy * width - padLeft + kx;
            const outRow = outBase + oy * outW;
            for (let ox = oxStart; ox < oxEnd; ox++) out[outRow + ox] += weight * x[inRow + ox * strideW];
          }
        }
      }
    }
  }
}

/** Input patches as rows of a [channels·kernelH·kernelW, outH·outW] matrix (zero outside the image). */
function im2col(
  x: Float32Array,
  { channels, height, width }: { channels: number; height: number; width: number },
  { outH, outW, kernelH, kernelW, strideH, strideW, padTop, padLeft }: ConvGeometry,
  columns: Float32Array,
): void {
  const outSize = outH * outW;
  let row = 0;
  for (let c = 0; c < channels; c++) {
    const inBase = c * height * width;
    for (let ky = 0; ky < kernelH; ky++) {
      for (let kx = 0; kx < kernelW; kx++, row++) {
        const rowBase = row * outSize;
        for (let oy = 0; oy < outH; oy++) {
          const iy = oy * strideH - padTop + ky;
          const outRow = rowBase + oy * outW;
          if (iy < 0 || iy >= height) {
            columns.fill(0, outRow, outRow + outW);
            continue;
          }
          const inRow = inBase + iy * width;
          for (let ox = 0; ox < outW; ox++) {
            const ix = ox * strideW - padLeft + kx;
            columns[outRow + ox] = ix >= 0 && ix < width ? x[inRow + ix] : 0;
          }
        }
      }
    }
  }
}

/** Depthwise 3×3 convolution (one filter per channel, any padding and stride); interior pixels take a fast path. */
function depthwiseConv3x3(
  x: Float32Array,
  { channels, height, width }: { channels: number; height: number; width: number },
  w: Float32Array,
  bias: Float32Array | null,
  { outH, outW, strideH, strideW, padTop, padLeft }: ConvGeometry,
  out: Float32Array,
): void {
  for (let c = 0; c < channels; c++) {
    const inBase = c * height * width;
    const outBase = c * outH * outW;
    const k = c * 9;
    const w0 = w[k];
    const w1 = w[k + 1];
    const w2 = w[k + 2];
    const w3 = w[k + 3];
    const w4 = w[k + 4];
    const w5 = w[k + 5];
    const w6 = w[k + 6];
    const w7 = w[k + 7];
    const w8 = w[k + 8];
    const b = bias ? bias[c] : 0;
    for (let oy = 0; oy < outH; oy++) {
      const iy = oy * strideH - padTop;
      const rowInside = iy >= 0 && iy + 2 < height;
      for (let ox = 0; ox < outW; ox++) {
        const ix = ox * strideW - padLeft;
        let sum = b;
        if (rowInside && ix >= 0 && ix + 2 < width) {
          const i = inBase + iy * width + ix;
          const j = i + width;
          const l = j + width;
          sum +=
            w0 * x[i] + w1 * x[i + 1] + w2 * x[i + 2] +
            w3 * x[j] + w4 * x[j + 1] + w5 * x[j + 2] +
            w6 * x[l] + w7 * x[l + 1] + w8 * x[l + 2];
        } else {
          for (let ky = 0; ky < 3; ky++) {
            const y = iy + ky;
            if (y < 0 || y >= height) continue;
            for (let kx = 0; kx < 3; kx++) {
              const xx = ix + kx;
              if (xx >= 0 && xx < width) sum += w[k + ky * 3 + kx] * x[inBase + y * width + xx];
            }
          }
        }
        out[outBase + oy * outW + ox] = sum;
      }
    }
  }
}

/** Elementwise Add/Mul with NumPy-style broadcasting. */
function compileBinary(op: 'Add' | 'Mul', a: Value, b: Value): { output: Value; step: () => void } {
  const rank = Math.max(a.shape.length, b.shape.length);
  const align = (shape: number[]) => [...Array<number>(rank - shape.length).fill(1), ...shape];
  const shapeA = align(a.shape);
  const shapeB = align(b.shape);
  const shape = shapeA.map((size, axis) => {
    const other = shapeB[axis];
    if (size !== other && size !== 1 && other !== 1) throw new Error(`Cannot broadcast ${a.shape} with ${b.shape}`);
    return Math.max(size, other);
  });
  const strides = (inputShape: number[]) => {
    const result = new Array<number>(rank).fill(0);
    let stride = 1;
    for (let axis = rank - 1; axis >= 0; axis--) {
      result[axis] = inputShape[axis] === 1 ? 0 : stride;
      stride *= inputShape[axis];
    }
    return result;
  };
  // Merge neighbouring axes that both operands walk the same way, so a per-channel scale is a single
  // [channels, height·width] loop.
  const dims: Array<{ size: number; strideA: number; strideB: number }> = [];
  const stridesA = strides(shapeA);
  const stridesB = strides(shapeB);
  for (let axis = 0; axis < rank; axis++) {
    const dim = { size: shape[axis], strideA: stridesA[axis], strideB: stridesB[axis] };
    if (dim.size === 1) continue;
    const last = dims[dims.length - 1];
    if (last && last.strideA === dim.strideA * dim.size && last.strideB === dim.strideB * dim.size) {
      last.size *= dim.size;
      last.strideA = dim.strideA;
      last.strideB = dim.strideB;
    } else dims.push(dim);
  }
  if (dims.length === 0) dims.push({ size: 1, strideA: 0, strideB: 0 });

  const output = { shape, data: new Float32Array(product(shape)) };
  const out = output.data;
  const inner = dims[dims.length - 1];
  const outer = dims.slice(0, -1);
  const outerCount = product(outer.map((dim) => dim.size));
  const add = op === 'Add';
  return {
    output,
    step: () => {
      const x = a.data;
      const y = b.data;
      for (let block = 0; block < outerCount; block++) {
        let offsetA = 0;
        let offsetB = 0;
        for (let axis = outer.length - 1, rest = block; axis >= 0; axis--) {
          const index = rest % outer[axis].size;
          rest = Math.floor(rest / outer[axis].size);
          offsetA += index * outer[axis].strideA;
          offsetB += index * outer[axis].strideB;
        }
        const base = block * inner.size;
        const { size, strideA, strideB } = inner;
        if (add) for (let i = 0; i < size; i++) out[base + i] = x[offsetA + i * strideA] + y[offsetB + i * strideB];
        else for (let i = 0; i < size; i++) out[base + i] = x[offsetA + i * strideA] * y[offsetB + i * strideB];
      }
    },
  };
}

/** Mean or max over the last `axes` axes. */
function compileReduce(x: Value, axes: number, keepDims: boolean, mode: 'mean' | 'max'): { output: Value; step: () => void } {
  const rank = x.shape.length;
  const kept = x.shape.slice(0, rank - axes);
  const inner = product(x.shape.slice(rank - axes));
  const outer = product(kept);
  const shape = keepDims ? [...kept, ...Array<number>(axes).fill(1)] : kept;
  const output = { shape, data: new Float32Array(outer) };
  return {
    output,
    step: () => {
      const data = x.data;
      for (let o = 0; o < outer; o++) {
        const start = o * inner;
        if (mode === 'max') {
          let max = -Infinity;
          for (let i = start; i < start + inner; i++) if (data[i] > max) max = data[i];
          output.data[o] = max;
        } else {
          let sum = 0;
          for (let i = start; i < start + inner; i++) sum += data[i];
          output.data[o] = sum / inner;
        }
      }
    },
  };
}

function compileConcat(inputs: Value[], axisAttribute: number): { output: Value; step: () => void } {
  const rank = inputs[0].shape.length;
  const axis = axisAttribute < 0 ? axisAttribute + rank : axisAttribute;
  for (const input of inputs) {
    if (input.shape.length !== rank || input.shape.some((size, i) => i !== axis && size !== inputs[0].shape[i])) {
      throw new Error('Concat of mismatched shapes');
    }
  }
  const shape = inputs[0].shape.map((size, i) => (i === axis ? inputs.reduce((sum, input) => sum + input.shape[axis], 0) : size));
  const outer = product(shape.slice(0, axis));
  const chunks = inputs.map((input) => product(input.shape.slice(axis)));
  const output = { shape, data: new Float32Array(product(shape)) };
  return {
    output,
    step: () => {
      let offset = 0;
      for (let o = 0; o < outer; o++) {
        inputs.forEach((input, i) => {
          output.data.set(input.data.subarray(o * chunks[i], (o + 1) * chunks[i]), offset);
          offset += chunks[i];
        });
      }
    },
  };
}

/** alpha · A · B(ᵀ) + beta · C, with C broadcast to the [M, N] result. */
function compileGemm(node: OnnxNode, a: Value, b: Value, c: Value | null): { output: Value; step: () => void } {
  if (intAttribute(node, 'transA', 0) !== 0 || a.shape.length !== 2 || b.shape.length !== 2) {
    throw new Error('Unsupported Gemm');
  }
  const transB = intAttribute(node, 'transB', 0) === 1;
  const alphaAttribute = node.attributes.alpha;
  const betaAttribute = node.attributes.beta;
  const alpha = typeof alphaAttribute === 'number' ? alphaAttribute : 1;
  const beta = typeof betaAttribute === 'number' ? betaAttribute : 1;
  const [m, k] = a.shape;
  const n = transB ? b.shape[0] : b.shape[1];
  if ((transB ? b.shape[1] : b.shape[0]) !== k) throw new Error('Gemm shape mismatch');
  const cShape = c ? [...Array<number>(Math.max(0, 2 - c.shape.length)).fill(1), ...c.shape] : [1, 1];
  const cRowStride = cShape[0] === 1 ? 0 : cShape[1];
  const cColumnStride = cShape[1] === 1 ? 0 : 1;
  const output = { shape: [m, n], data: new Float32Array(m * n) };
  return {
    output,
    step: () => {
      const x = a.data;
      const weights = b.data;
      for (let row = 0; row < m; row++) {
        for (let column = 0; column < n; column++) {
          let sum = 0;
          for (let i = 0; i < k; i++) {
            sum += x[row * k + i] * (transB ? weights[column * k + i] : weights[i * n + column]);
          }
          const offset = c ? beta * c.data[row * cRowStride + column * cColumnStride] : 0;
          output.data[row * n + column] = alpha * sum + offset;
        }
      }
    },
  };
}

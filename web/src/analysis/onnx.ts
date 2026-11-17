// Reads the subset of the ONNX file format (a protobuf ModelProto) that the eye models use: the graph's nodes and
// attributes, float32/int64 initializers stored inline, and the input/output shapes. External data, sparse tensors
// and subgraphs aren't supported (the models don't use them).

export type OnnxAttribute = number | number[] | string | OnnxTensor;

export interface OnnxTensor {
  name: string;
  dims: number[];
  /** float32 data, or the values of an integer tensor. */
  data: Float32Array | number[];
}

export interface OnnxNode {
  opType: string;
  inputs: string[];
  outputs: string[];
  attributes: Record<string, OnnxAttribute>;
}

export interface OnnxValueInfo {
  name: string;
  /** Dimension sizes; a named (symbolic) dimension such as the batch is reported as -1. */
  shape: number[];
}

export interface OnnxGraph {
  /** Default-domain operator set version. */
  opset: number;
  /** In topological order (required by the ONNX spec). */
  nodes: OnnxNode[];
  initializers: Map<string, OnnxTensor>;
  inputs: OnnxValueInfo[];
  outputs: OnnxValueInfo[];
}

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;

// TensorProto.DataType
const FLOAT = 1;
const INT32 = 6;
const INT64 = 7;

const textDecoder = new TextDecoder();

class ProtoReader {
  private position = 0;
  private readonly end: number;

  constructor(private readonly bytes: Uint8Array) {
    this.end = bytes.length;
  }

  get done(): boolean {
    return this.position >= this.end;
  }

  /** Field number and wire type of the next field. */
  tag(): [field: number, wire: number] {
    const key = this.uint();
    return [Math.floor(key / 8), key % 8];
  }

  varint(): bigint {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.position >= this.end) throw new Error('Truncated ONNX file');
      const byte = this.bytes[this.position++];
      result |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return result;
    }
    throw new Error('Malformed varint in ONNX file');
  }

  uint(): number {
    return Number(this.varint());
  }

  int64(): number {
    return Number(BigInt.asIntN(64, this.varint()));
  }

  float(): number {
    if (this.position + 4 > this.end) throw new Error('Truncated ONNX file');
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.position, 4).getFloat32(0, true);
    this.position += 4;
    return value;
  }

  /** The bytes of a length-delimited field. */
  chunk(): Uint8Array {
    const length = this.uint();
    const start = this.position;
    this.position += length;
    if (this.position > this.end) throw new Error('Truncated ONNX file');
    return this.bytes.subarray(start, this.position);
  }

  string(): string {
    return textDecoder.decode(this.chunk());
  }

  message(): ProtoReader {
    return new ProtoReader(this.chunk());
  }

  /** Repeated integer field: packed (one length-delimited chunk) or a single value. */
  int64s(wire: number, into: number[]): void {
    if (wire !== WIRE_BYTES) {
      into.push(this.int64());
      return;
    }
    const packed = this.message();
    while (!packed.done) into.push(packed.int64());
  }

  /** Repeated float field: packed or a single value. */
  floats(wire: number, into: number[]): void {
    if (wire !== WIRE_BYTES) {
      into.push(this.float());
      return;
    }
    const packed = this.message();
    while (!packed.done) into.push(packed.float());
  }

  skip(wire: number): void {
    if (wire === WIRE_VARINT) this.varint();
    else if (wire === WIRE_FIXED64) this.position += 8;
    else if (wire === WIRE_BYTES) this.chunk();
    else if (wire === WIRE_FIXED32) this.position += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire} in ONNX file`);
  }
}

/** Reads a message's fields in order; `read` returns false for the fields it doesn't consume, which are skipped. */
function readFields(reader: ProtoReader, read: (field: number, wire: number) => boolean): void {
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (!read(field, wire)) reader.skip(wire);
  }
}

export function parseOnnx(bytes: Uint8Array): OnnxGraph {
  const model = new ProtoReader(bytes);
  let graph: Omit<OnnxGraph, 'opset'> | null = null;
  let opset = 0;
  readFields(model, (field, wire) => {
    if (wire !== WIRE_BYTES) return false;
    if (field === 7) graph = readGraph(model.message());
    else if (field === 8) {
      const operatorSet = model.message();
      let domain = '';
      let version = 0;
      readFields(operatorSet, (f, w) => {
        if (f === 1 && w === WIRE_BYTES) domain = operatorSet.string();
        else if (f === 2 && w === WIRE_VARINT) version = operatorSet.int64();
        else return false;
        return true;
      });
      if (domain === '' || domain === 'ai.onnx') opset = version;
    } else return false;
    return true;
  });
  if (!graph) throw new Error('ONNX file has no graph');
  return { opset, ...(graph as Omit<OnnxGraph, 'opset'>) };
}

function readGraph(reader: ProtoReader): Omit<OnnxGraph, 'opset'> {
  const nodes: OnnxNode[] = [];
  const initializers = new Map<string, OnnxTensor>();
  const inputs: OnnxValueInfo[] = [];
  const outputs: OnnxValueInfo[] = [];
  readFields(reader, (field, wire) => {
    if (wire !== WIRE_BYTES) return false;
    if (field === 1) nodes.push(readNode(reader.message()));
    else if (field === 5) {
      const tensor = readTensor(reader.message());
      initializers.set(tensor.name, tensor);
    } else if (field === 11) inputs.push(readValueInfo(reader.chunk()));
    else if (field === 12) outputs.push(readValueInfo(reader.chunk()));
    else if (field === 15) throw new Error('Sparse initializers are not supported');
    else return false;
    return true;
  });
  // Before IR version 4, initializers were also listed as graph inputs.
  return { nodes, initializers, inputs: inputs.filter((input) => !initializers.has(input.name)), outputs };
}

function readNode(reader: ProtoReader): OnnxNode {
  const node: OnnxNode = { opType: '', inputs: [], outputs: [], attributes: {} };
  let domain = '';
  readFields(reader, (field, wire) => {
    if (wire !== WIRE_BYTES) return false;
    if (field === 1) node.inputs.push(reader.string());
    else if (field === 2) node.outputs.push(reader.string());
    else if (field === 4) node.opType = reader.string();
    else if (field === 7) domain = reader.string();
    else if (field === 5) {
      const [name, value] = readAttribute(reader.message());
      if (value !== undefined) node.attributes[name] = value;
    } else return false;
    return true;
  });
  if (domain !== '' && domain !== 'ai.onnx') throw new Error(`Unsupported operator domain ${domain} (${node.opType})`);
  return node;
}

function readAttribute(reader: ProtoReader): [string, OnnxAttribute | undefined] {
  let name = '';
  let value: OnnxAttribute | undefined;
  const ints: number[] = [];
  const floats: number[] = [];
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === WIRE_BYTES) name = reader.string();
    else if (field === 2 && wire === WIRE_FIXED32) value = reader.float();
    else if (field === 3 && wire === WIRE_VARINT) value = reader.int64();
    else if (field === 4 && wire === WIRE_BYTES) value = reader.string();
    else if (field === 5 && wire === WIRE_BYTES) value = readTensor(reader.message());
    else if (field === 7) {
      reader.floats(wire, floats);
      value = floats;
    } else if (field === 8) {
      reader.int64s(wire, ints);
      value = ints;
    } else return false;
    return true;
  });
  return [name, value];
}

function readTensor(reader: ProtoReader): OnnxTensor {
  let name = '';
  const dims: number[] = [];
  let dataType = 0;
  let raw: Uint8Array | null = null;
  const floatData: number[] = [];
  const intData: number[] = [];
  readFields(reader, (field, wire) => {
    if (field === 1) reader.int64s(wire, dims);
    else if (field === 2 && wire === WIRE_VARINT) dataType = reader.uint();
    else if (field === 4) reader.floats(wire, floatData);
    else if (field === 5 || field === 7) reader.int64s(wire, intData);
    else if (field === 8 && wire === WIRE_BYTES) name = reader.string();
    else if (field === 9 && wire === WIRE_BYTES) raw = reader.chunk();
    else if (field === 14 && wire === WIRE_VARINT) {
      if (reader.uint() !== 0) throw new Error('ONNX tensors with external data are not supported');
    } else return false;
    return true;
  });
  const count = dims.reduce((product, dim) => product * dim, 1);
  const bytes = raw as Uint8Array | null;
  let data: Float32Array | number[];
  if (dataType === FLOAT) {
    if (bytes) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      data = new Float32Array(bytes.byteLength / 4);
      for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(i * 4, true);
    } else data = Float32Array.from(floatData);
  } else if (dataType === INT64 || dataType === INT32) {
    if (bytes) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const size = dataType === INT64 ? 8 : 4;
      data = [];
      for (let offset = 0; offset < bytes.byteLength; offset += size) {
        data.push(dataType === INT64 ? Number(view.getBigInt64(offset, true)) : view.getInt32(offset, true));
      }
    } else data = intData;
  } else {
    throw new Error(`Unsupported ONNX tensor data type ${dataType} (${name})`);
  }
  if (data.length !== count) throw new Error(`ONNX tensor ${name} has ${data.length} values, expected ${count}`);
  return { name, dims, data };
}

/** The sub-messages found by following `path` (field numbers) down from a message. */
function messagesAt(bytes: Uint8Array, path: readonly number[]): Uint8Array[] {
  const found: Uint8Array[] = [];
  const reader = new ProtoReader(bytes);
  readFields(reader, (field, wire) => {
    if (field !== path[0] || wire !== WIRE_BYTES) return false;
    const chunk = reader.chunk();
    if (path.length === 1) found.push(chunk);
    else found.push(...messagesAt(chunk, path.slice(1)));
    return true;
  });
  return found;
}

function readValueInfo(bytes: Uint8Array): OnnxValueInfo {
  const [nameBytes] = messagesAt(bytes, [1]);
  // ValueInfoProto.type → TypeProto.tensor_type → shape → dim (each a Dimension with dim_value = 1)
  const shape = messagesAt(bytes, [2, 1, 2, 1]).map((dimension) => {
    const reader = new ProtoReader(dimension);
    let size = -1;
    readFields(reader, (field, wire) => {
      if (field !== 1 || wire !== WIRE_VARINT) return false;
      size = reader.int64();
      return true;
    });
    return size;
  });
  return { name: nameBytes ? textDecoder.decode(nameBytes) : '', shape };
}

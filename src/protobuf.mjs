// Protobuf wire-format codec for targeted edits (https://protobuf.dev/programming-guides/encoding/).
// Every decoded record keeps its exact source bytes, so untouched fields are re-emitted verbatim and in order.
const VARINT = 0, I64 = 1, LEN = 2, I32 = 5;
const FIXED_WIDTH = new Map([[I64, 8], [I32, 4]]);
const MAX_RECORDS = 500_000, MAX_OUTPUT = 64 * 1024 * 1024, MAX_FIELD_NUMBER = 2 ** 29 - 1;
const fail = message => { throw new Error(message); };

export const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
export const text = bytes => strictUtf8.decode(bytes);
export const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export function concat(parts) {
  let size = 0;
  for (const part of parts) size += part.length;
  if (size > MAX_OUTPUT) fail('The resulting file exceeds the 64 MB limit.');
  const out = new Uint8Array(size);
  parts.reduce((offset, part) => { out.set(part, offset); return offset + part.length; }, 0);
  return out;
}

export function encodeVarint(input) {
  let rest = BigInt(input);
  if (rest < 0n || rest >= 1n << 64n) fail('Integer outside the protobuf range.');
  const out = [];
  while (rest >= 0x80n) { out.push(Number(rest % 0x80n) + 0x80); rest /= 0x80n; }
  out.push(Number(rest));
  return Uint8Array.from(out);
}

export function encodeRecord(id, wire, payload) {
  const tag = encodeVarint((BigInt(id) << 3n) | BigInt(wire));
  switch (wire) {
    case VARINT: return concat([tag, encodeVarint(payload)]);
    case LEN: return concat([tag, encodeVarint(payload.length), payload]);
    default: return concat([tag, payload]);
  }
}

class Cursor {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  get atEnd() { return this.offset >= this.bytes.length; }
  // Base-128 little-endian groups; a 64-bit value needs at most ten, and the tenth may carry one bit.
  varint() {
    let value = 0n;
    for (let group = 0; ; group++) {
      if (this.atEnd) fail('Truncated protobuf integer.');
      const byte = this.bytes[this.offset++];
      if (group === 9 && byte > 1) fail('Invalid protobuf integer.');
      value += BigInt(byte & 0x7f) << BigInt(7 * group);
      if (byte < 0x80) return value;
    }
  }
  slice(length) {
    if (length > BigInt(this.bytes.length - this.offset)) fail('Truncated protobuf field.');
    const begin = this.offset;
    this.offset += Number(length);
    return this.bytes.subarray(begin, this.offset);
  }
}

export function readRecords(bytes) {
  const cursor = new Cursor(bytes), records = [];
  while (!cursor.atEnd) {
    if (records.length === MAX_RECORDS) fail('Too many fields in this message.');
    const start = cursor.offset, tag = cursor.varint();
    const id = Number(tag >> 3n), wire = Number(tag & 7n);
    if (id < 1 || id > MAX_FIELD_NUMBER) fail('Invalid protobuf field number.');
    let value, data;
    if (wire === VARINT) value = cursor.varint();
    else if (wire === LEN) data = cursor.slice(cursor.varint());
    else if (FIXED_WIDTH.has(wire)) data = cursor.slice(BigInt(FIXED_WIDTH.get(wire)));
    else fail(`Unsupported protobuf wire type ${wire}.`);
    records.push({ id, wire, value, data, start, end: cursor.offset, raw: bytes.subarray(start, cursor.offset) });
  }
  return records;
}

export function optional(bytes, id, wire = LEN) {
  const matches = readRecords(bytes).filter(r => r.id === id);
  if (matches.length > 1 || (matches.length === 1 && matches[0].wire !== wire)) fail(`Ambiguous or unsupported field ${id}.`);
  return matches[0];
}
export function required(bytes, id, wire = LEN) {
  const record = optional(bytes, id, wire);
  if (!record) fail(`Required field ${id} is missing.`);
  return wire === VARINT ? record.value : record.data;
}
export function number(bytes, id, fallback = 0) {
  const record = optional(bytes, id, VARINT);
  if (!record) return fallback;
  if (record.value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`Field ${id} is too large.`);
  return Number(record.value);
}
export function string(bytes, id, fallback = '') {
  const record = optional(bytes, id);
  return record ? text(record.data) : fallback;
}

// Replace the single occurrence of a field by splicing at its byte offsets.
export function withRecord(bytes, id, wire, payload) {
  required(bytes, id, wire);
  const target = readRecords(bytes).find(r => r.id === id);
  return concat([bytes.subarray(0, target.start), encodeRecord(id, wire, payload), bytes.subarray(target.end)]);
}

// Paths address a field's physical position, not its number (repeated wrappers are legal).
export function atPath(bytes, path) {
  for (const index of path) {
    const record = readRecords(bytes)[index];
    if (!record || record.wire !== LEN) fail('The selected record no longer exists.');
    bytes = record.data;
  }
  return bytes;
}
export function editPaths(bytes, edits, depth = 0) {
  if (depth === 0) for (const edit of edits) atPath(bytes, edit.path);
  const exact = edits.find(e => e.path.length === depth);
  if (exact) {
    if (edits.length !== 1) fail('Overlapping edits are not allowed.');
    return exact.bytes;
  }
  return concat(readRecords(bytes).map((record, index) => {
    const nested = edits.filter(e => e.path[depth] === index);
    if (!nested.length) return record.raw;
    if (record.wire !== LEN) fail('Cannot edit inside a scalar field.');
    return encodeRecord(record.id, LEN, editPaths(record.data, nested, depth + 1));
  }));
}

// GIL/GIA container: a 20-byte big-endian header, a protobuf payload and a 4-byte trailer.
const HEADER = 20, TRAILER = 4, HEADER_MARK = 0x326, TRAILER_MARK = 0x679, FORMATS = { 2: 'GIL', 3: 'GIA' };
export function openContainer(input) {
  const bytes = new Uint8Array(input);
  if (bytes.length < HEADER + TRAILER || bytes.length > 32 * 1024 * 1024) fail('Choose a GIL or GIA file between 24 bytes and 32 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadLength = bytes.length - HEADER - TRAILER;
  const framed = view.getUint32(0) === bytes.length - 4 && view.getUint32(8) === HEADER_MARK &&
    view.getUint32(16) === payloadLength && view.getUint32(bytes.length - TRAILER) === TRAILER_MARK;
  if (!framed) fail('This file has an unsupported or damaged GIL/GIA container. No changes were made.');
  if (view.getUint32(4) !== 1) fail('This container version is not supported.');
  const type = view.getUint32(12);
  if (!FORMATS[type]) fail('Only GIL stage files and GIA asset files are supported.');
  const payload = bytes.subarray(HEADER, HEADER + payloadLength);
  readRecords(payload);
  return { bytes, payload, format: FORMATS[type], type };
}
export function rewrap(container, payload) {
  const out = concat([container.bytes.subarray(0, HEADER), payload, container.bytes.subarray(-TRAILER)]);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, out.length - 4);
  view.setUint32(16, payload.length);
  return out;
}

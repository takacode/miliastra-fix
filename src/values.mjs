import { encodeRecord, concat, utf8, optional, required, number, string, readRecords, withRecord } from './protobuf.mjs';

export const TYPES = { 1: 'Entity', 2: 'GUID', 3: 'Integer', 4: 'Boolean', 5: 'Float', 6: 'String', 7: 'GUID list', 8: 'Integer list', 9: 'Boolean list', 10: 'Float list', 11: 'String list', 12: 'Vector', 13: 'Entity list', 14: 'Enum', 15: 'Vector list', 16: 'Local variable', 17: 'Faction', 20: 'Config ID', 21: 'Prefab ID', 22: 'Config ID list', 23: 'Prefab ID list', 24: 'Faction list', 25: 'Structure', 26: 'Structure list', 27: 'Dictionary', 28: 'Snapshot' };
export const SCALARS = [1, 3, 4, 5, 6];
export const DEFAULTS = { 1: 'null entity', 3: '0', 4: 'false', 5: '0', 6: 'empty string' };
const widgets = { 1: 1, 3: 2, 4: 6, 5: 4, 6: 5 };
const storage = { 1: 101, 3: 102, 4: 106, 5: 104, 6: 105 };
export const defaultFor = type => type === 6 ? '' : type === 4 ? false : type === 1 ? null : 0;
export function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || /[\u0000-\u001f\u007f]/u.test(name) || utf8.encode(name).length > 128 || name !== name.trim()) throw new Error('Names must be 1–128 UTF-8 bytes, without control characters or surrounding spaces.');
  return name;
}
export function validateValue(type, value) {
  if (!SCALARS.includes(type)) throw new Error('Editing initial values is supported for Entity, Integer, Boolean, Float and String.');
  if (type === 1 && value !== null) throw new Error('Entity initial values can only be null.');
  if (type === 3 && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) throw new Error('Integer must be between −2,147,483,648 and 2,147,483,647.');
  if (type === 4 && typeof value !== 'boolean') throw new Error('Choose true or false.');
  if (type === 5 && (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) throw new Error('Float must be a finite 32-bit number.');
  if (type === 6 && (typeof value !== 'string' || utf8.encode(value).length > 4096 || value.includes('\0'))) throw new Error('Strings must be at most 4,096 UTF-8 bytes and contain no null characters.');
  return type === 5 ? Math.fround(value) : value;
}
export function encodeValue(type, input = defaultFor(type)) {
  const value = validateValue(type, input);
  let body = new Uint8Array();
  if (value !== defaultFor(type)) {
    if (type === 3) body = encodeRecord(1, 0, BigInt.asUintN(64, BigInt(value)));
    if (type === 4) body = encodeRecord(1, 0, 1);
    if (type === 5) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, value, true); body = encodeRecord(1, 5, bytes); }
    if (type === 6) body = encodeRecord(1, 2, utf8.encode(value));
  }
  return concat([encodeRecord(1, 0, widgets[type]), ...(body.length ? [encodeRecord(2, 0, 1)] : []), encodeRecord(4, 2, concat([encodeRecord(1, 0, 1), encodeRecord(100, 2, encodeRecord(1, 0, type))])), encodeRecord(storage[type], 2, body)]);
}
export function declaration(name, type, value = defaultFor(type)) {
  validateName(name);
  return concat([encodeRecord(2, 2, utf8.encode(name)), encodeRecord(3, 0, type), encodeRecord(4, 2, encodeValue(type, value)), encodeRecord(7, 0, 6), encodeRecord(8, 0, 6)]);
}
export function serverType(value) {
  const td = optional(value, 4);
  if (!td) return 0;
  if (optional(td.data, 101)) return -1;
  if (number(td.data, 1) !== 1) return -1;
  const ss = optional(td.data, 100);
  if (ss && optional(ss.data, 100) && optional(ss.data, 101)) return -1;
  return ss ? number(ss.data, 1) : 0;
}
export function valueMatchesType(value, type, depth = 0) {
  if (depth > 12) return false;
  const declared = serverType(value);
  if (declared && declared !== type) return false;
  const stores = readRecords(value).filter(f => f.id >= 101 && f.id <= 112);
  if (stores.length > 1) return false;
  const poly = optional(value, 110);
  if (poly) { const actual = optional(poly.data, 2); return !actual || valueMatchesType(actual.data, type, depth + 1); }
  return !SCALARS.includes(type) || !stores.length || stores[0].id === storage[type];
}
export function decodeValue(value, type) {
  if (!SCALARS.includes(type)) return { supported: false, label: TYPES[type] || `Type ${type}` };
  try {
    if (serverType(value) && serverType(value) !== type) throw new Error('Type metadata mismatch');
    if (readRecords(value).some(f => f.id >= 101 && f.id <= 112 && f.id !== storage[type])) throw new Error('Conflicting storage');
    const body = required(value, storage[type]); let result = defaultFor(type);
    if (type === 1 && number(body, 1) !== 0) return { supported: false, label: 'Entity reference' };
    if (type === 3) { const f = optional(body, 1, 0); if (f && f.value > 0xffffffffn && BigInt.asUintN(64, BigInt.asIntN(32, f.value)) !== f.value) throw new Error('Integer outside 32-bit range'); result = f ? Number(BigInt.asIntN(32, f.value)) : 0; }
    if (type === 4) { const n = number(body, 1); if (n > 1) throw new Error('Invalid boolean'); result = !!n; }
    if (type === 5) { const f = optional(body, 1, 5); result = f ? new DataView(f.data.buffer, f.data.byteOffset, 4).getFloat32(0, true) : 0; }
    if (type === 6) result = string(body, 1);
    validateValue(type, result);
    return { supported: true, value: result, label: displayValue(result) };
  } catch { return { supported: false, label: 'Unsupported value encoding' }; }
}
export function displayValue(value) {
  if (value === null) return 'null entity';
  if (value === '') return 'empty string';
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}
export function updateValue(original, type, input) {
  const value = validateValue(type, input);
  if (!decodeValue(original, type).supported) throw new Error('The existing initial value cannot be edited safely.');
  const set = (bytes, id, wire, data) => optional(bytes, id, wire) ? withRecord(bytes, id, wire, data) : concat([bytes, encodeRecord(id, wire, data)]);
  let body = required(original, storage[type]);
  if (type === 1) return original.slice();
  if (type === 3) body = set(body, 1, 0, BigInt.asUintN(64, BigInt(value)));
  if (type === 4) body = set(body, 1, 0, value ? 1 : 0);
  if (type === 5) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, value, true); body = set(body, 1, 5, bytes); }
  if (type === 6) body = set(body, 1, 2, utf8.encode(value));
  return set(withRecord(original, storage[type], 2, body), 2, 0, 1);
}

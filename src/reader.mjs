import { readRecords, required, optional, number, string, openContainer } from './protobuf.mjs';
import { TYPES, decodeValue } from './values.mjs';
export function located(bytes, id) {
  return readRecords(bytes).flatMap((f, index) => {
    if (f.id !== id) return [];
    if (f.wire !== 2) throw new Error(`Invalid message field ${id}.`);
    return [{ bytes: f.data, index }];
  });
}
export function child(bytes, id) { required(bytes, id); return located(bytes, id)[0]; }
export const locator = bytes => ({ origin: number(bytes, 1), service: number(bytes, 2), kind: number(bytes, 3), id: number(bytes, 5) });
export const locatorKey = l => l ? `${l.origin}:${l.service}:${l.kind}:${l.id}` : '';
export const signature = bytes => ({ kind: number(bytes, 1), slot: number(bytes, 2) });
export const signatureKey = s => `${s.kind}:${s.slot}`;
export const endpointKey = (node, pin) => `${node}:${pin.kind}:${pin.slot}`;
export const SERVICES = { 20000: 'Entity', 20003: 'Status', 20004: 'Class', 20005: 'Item', 20001: 'Client filter', 20002: 'Client skill', 20006: 'Integer filter', 20007: 'Creation decision', 20008: 'Creation skill', 20009: 'Creation status', 20010: 'Character control' };
export const serverServices = new Set([20000, 20003, 20004, 20005]);
function records(container, suffix) {
  const out = [];
  const visit = (bytes, path, ids, source) => {
    if (!ids.length) { out.push({ bytes, path, source }); return; }
    for (const item of located(bytes, ids[0])) visit(item.bytes, [...path, item.index], ids.slice(1), source);
  };
  if (container.format === 'GIL') {
    if (suffix === 'graph') { visit(container.payload, [], [10, 1, 1], 'Stage graph'); visit(container.payload, [], [10, 4, 1], 'Composite body'); }
    else visit(container.payload, [], [10, 2, 1], 'Interface');
  } else for (const [root, source] of [[1, 'Asset'], [2, 'Dependency']]) visit(container.payload, [], [root, suffix === 'graph' ? 13 : 14, 1, 1], source);
  if (out.length > 4000) throw new Error('This file has more than 4,000 graph or interface records.');
  return out;
}
function graphRecord(record) {
  const g = { ...record, key: record.path.join('.'), name: '(unnamed graph)', variables: [], nodeRecords: [], mappings: [], errors: [], identity: null };
  try {
    const b = record.bytes; g.name = string(b, 2) || g.name; g.identity = locator(required(b, 1));
    g.category = SERVICES[g.identity.service] || `Service ${g.identity.service}`;
    g.composite = g.identity.kind === 21002 || record.source === 'Composite body';
    for (const item of located(b, 6)) {
      const v = { name: string(item.bytes, 2), type: number(item.bytes, 3), public: !!number(item.bytes, 5), path: [item.index], bytes: item.bytes };
      v.typeName = TYPES[v.type] || `Type ${v.type}`;
      const value = optional(item.bytes, 4); v.initial = value ? decodeValue(value.data, v.type) : { supported: false, label: 'Missing value' };
      g.variables.push(v);
    }
    const names = new Set(); for (const v of g.variables) { if (names.has(v.name)) g.errors.push('Duplicate variable declarations make this graph ambiguous.'); names.add(v.name); }
    for (const item of located(b, 4)) {
      const m = item.bytes, kernel = optional(m, 4); g.mappings.push({ external: signature(required(m, 1)), node: number(m, 2), internal: signature(required(m, 3)), kernel: kernel ? signature(kernel.data) : null });
    }
    const nodeIds = new Set();
    for (const item of located(b, 3)) {
      const n = { id: number(item.bytes, 1), shell: locator(required(item.bytes, 2)), pins: [], path: [item.index], bytes: item.bytes };
      const kernel = optional(item.bytes, 3); n.kernel = kernel ? locator(kernel.data) : null;
      if (nodeIds.has(n.id)) g.errors.push('Duplicate node indexes make this graph ambiguous.'); nodeIds.add(n.id);
      const pinIds = new Set();
      for (const p of located(item.bytes, 4)) {
        const pk = optional(p.bytes, 2), uid = optional(p.bytes, 7, 0);
        const pin = { ...signature(required(p.bytes, 1)), bytes: p.bytes, path: [...n.path, p.index], connections: [], type: number(p.bytes, 4), kernel: pk ? signature(pk.data) : null, uid: uid?.value.toString() };
        if (pinIds.has(signatureKey(pin))) g.errors.push(`Duplicate pins on node #${n.id}.`); pinIds.add(signatureKey(pin));
        for (const c of located(p.bytes, 5)) { const ck = optional(c.bytes, 3); pin.connections.push({ node: number(c.bytes, 1), ...signature(required(c.bytes, 2)), kernel: ck ? signature(ck.data) : null }); }
        n.pins.push(pin);
      }
      g.nodeRecords.push(n);
    }
    if (g.nodeRecords.length > 10000) throw new Error('This graph exceeds 10,000 physical nodes.');
    g.byId = new Map(g.nodeRecords.map(n => [n.id, n])); g.incoming = new Map();
    for (const m of g.mappings) {
      if (![1, 2, 3, 4].includes(m.external.kind) || !sameMappingFamily(m.external.kind, m.internal.kind) || !g.byId.has(m.node)) g.errors.push('Invalid composite port mapping.');
      const target = g.byId.get(m.node)?.pins.find(p => signatureKey(p) === signatureKey(m.internal));
      if (target?.kernel && m.kernel && signatureKey(target.kernel) !== signatureKey(m.kernel)) g.errors.push('Composite port kernel signature disagrees with its target pin.');
    }
    const edgeSet = new Set();
    for (const n of g.nodeRecords) for (const pin of n.pins) for (const c of pin.connections) {
      const target = g.byId.get(c.node)?.pins.find(p => signatureKey(p) === signatureKey(c));
      if (target?.kernel && c.kernel && signatureKey(target.kernel) !== signatureKey(c.kernel)) g.errors.push(`Connection kernel signature disagrees with node #${c.node}.`);
      const own = { node: n.id, kind: pin.kind, slot: pin.slot }, other = c;
      const input = [1, 3].includes(pin.kind) ? own : other, output = [1, 3].includes(pin.kind) ? other : own;
      if (!((input.kind === 1 && output.kind === 2) || (input.kind === 3 && output.kind === 4))) { g.errors.push(`Unrecognized connection at node #${n.id}.`); continue; }
      const key = endpointKey(input.node, input), edge = `${key}<${endpointKey(output.node, output)}`;
      if (edgeSet.has(edge)) continue; edgeSet.add(edge);
      if (!g.incoming.has(key)) g.incoming.set(key, []); g.incoming.get(key).push(output);
      if (!g.byId.has(c.node)) g.errors.push(`Connection to missing node #${c.node}.`);
    }
  } catch (error) { g.errors.push(`Unsupported graph encoding: ${error.message}`); }
  return g;
}
function sameMappingFamily(external, internal) { return external === internal; }
function interfaceRecord(record) {
  const i = { name: '(unnamed interface)', pins: [], errors: [] };
  try {
    const b = record.bytes, id = required(b, 4); i.name = string(b, 200) || i.name; i.shell = locator(required(id, 1));
    const kernel = optional(id, 2); i.kernel = kernel ? locator(kernel.data) : null;
    const body = optional(id, 4); i.body = body ? locator(body.data) : null;
    const impl = optional(b, 107); i.category = impl ? number(impl.data, 1) : 0;
    // Metadata pins (106) use their own signature schema; they are not flow/data ports.
    for (const p of [100, 101, 102, 103].flatMap(id => located(b, id))) {
      const uid = optional(p.bytes, 8, 0), pin = { ...signature(required(p.bytes, 3)), name: string(p.bytes, 1), uid: uid?.value.toString() };
      if (i.pins.some(old => signatureKey(old) === signatureKey(pin))) i.errors.push('Duplicate interface pin signatures.');
      i.pins.push(pin);
    }
  } catch (error) { i.errors.push(error.message); }
  return i;
}
export function parseDocument(input) {
  const container = openContainer(input), graphs = records(container, 'graph').map(graphRecord), interfaces = records(container, 'interface').map(interfaceRecord);
  const graphIndex = new Map(), interfaceIndex = new Map();
  for (const g of graphs) { const key = locatorKey(g.identity); if (!graphIndex.has(key)) graphIndex.set(key, []); graphIndex.get(key).push(g); }
  for (const list of graphIndex.values()) if (list.length > 1) for (const g of list) g.errors.push('This graph identity occurs more than once in the file.');
  for (const i of interfaces) { const key = locatorKey(i.shell); if (!interfaceIndex.has(key)) interfaceIndex.set(key, []); interfaceIndex.get(key).push(i); }
  for (const i of interfaces) if (i.body) for (const g of graphIndex.get(locatorKey(i.body)) || []) if (g.name === '(unnamed graph)') g.name = i.name;
  return { container, graphs, interfaces, graphIndex, interfaceIndex };
}

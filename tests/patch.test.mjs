import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRecord as f, concat as join, readRecords, required, optional, string, withRecord, atPath, editPaths, openContainer, rewrap, equal, utf8 } from '../src/protobuf.mjs';
import { inspect, patch, declaration, validateName } from '../src/graph.mjs';
import { graph, asset, container, variableNode, simpleNode, callNode, sig, loc, demo } from '../src/demo.mjs';

const file = options => container(asset(graph(options)));
const first = bytes => inspect(bytes).graphs[0];
const change = (bytes, op) => ({ graph: first(bytes).key, ...op });
const declare = (bytes, name = 'Score', type = 3) => patch(bytes, [change(bytes, { kind: 'declare', name, type })]);
const rename = (bytes, name = 'RoundTime', to = 'SecondsRemaining') => patch(bytes, [change(bytes, { kind: 'rename', name, to })]);
const hasReason = (bytes, pattern) => assert.ok(first(bytes).blockers.some(b => pattern.test(b)), first(bytes).blockers.join('\n'));
const rawGraph = bytes => atPath(openContainer(bytes).payload, first(bytes).path);

test('demo distinguishes repairable missing declarations from unsafe informational findings', () => {
  assert.deepEqual(inspect(demo()).stats, { graphs: 7, ownerGraphs: 5, composites: 2, nodes: 14, variables: 3, repairs: 6, findings: 9, errors: 0, completeGraphs: 4 });
  assert.equal(inspect(demo()).graphs.at(-1).findings.filter(f => f.repairable).length, 0);
});
test('no-op preserves every byte, including unknown fields and noncanonical varints', () => {
  const opaque = Uint8Array.of(0xa0, 6, 0x81, 0); // unknown field 100, overlong integer 1
  const original = container(join([asset(graph()), opaque]));
  assert.deepEqual(patch(original, []).bytes, original);
});
test('adds one missing declaration while preserving all existing graph fields', () => {
  const original = file({ nodes: [variableNode(1, 'Score'), variableNode(2, 'Score', 3, 'Set')], extra: [f(200, 2, Uint8Array.of(0, 255, 44))] });
  const saved = original.slice(), result = declare(original);
  assert.deepEqual(original, saved, 'input is never mutated');
  const before = readRecords(rawGraph(original)), after = readRecords(rawGraph(result.bytes));
  before.forEach((record, index) => assert.deepEqual(after[index].raw, record.raw));
  assert.equal(after.length, before.length + 1);
  assert.equal(first(result.bytes).variables[0].references, 2);
  assert.equal(first(result.bytes).findings.length, 0);
  assert.throws(() => declare(result.bytes), /no longer matches/);
});
test('native observed scalar defaults are reproduced exactly', () => {
  const values = { 1: '080122070801a206020801aa0600', 3: '080222070801a206020803b20600', 4: '080622070801a206020804d20600', 5: '080422070801a206020805c20600', 6: '080522070801a206020806ca0600' };
  for (const [type, hex] of Object.entries(values)) {
    const original = file({ nodes: [variableNode(1, 'Value', Number(type))] });
    const result = declare(original, 'Value', Number(type));
    const variable = readRecords(rawGraph(result.bytes)).find(f => f.id === 6).data;
    assert.equal(Buffer.from(required(variable, 4)).toString('hex'), hex);
    assert.equal(optional(variable, 5, 0), undefined, 'not exposed');
  }
});
test('scoped rename changes only the declaration name and matching name-pin strings', () => {
  const sameTextInComment = f(5, 2, f(1, 2, utf8.encode('RoundTime')));
  const g = graph({ nodes: [variableNode(1, 'RoundTime'), variableNode(2, 'RoundTime', 3, 'Set'), variableNode(3, 'Unchanged', 6)], variables: [declaration('RoundTime', 3), declaration('Unchanged', 6)], extra: [sameTextInComment] });
  const other = graph({ id: 1073741826, name: 'Other', nodes: [variableNode(1, 'RoundTime')], variables: [declaration('RoundTime', 3)] });
  const bytes = container(join([asset(g), asset(other, 2), f(99, 2, utf8.encode('RoundTime'))]));
  const result = rename(bytes, 'RoundTime', '倒數Seconds');
  const next = first(result.bytes);
  assert.equal(next.variables.find(v => v.name === '倒數Seconds').references, 2);
  assert.ok(!next.references.some(r => r.name === 'RoundTime'));
  const before = openContainer(bytes), after = openContainer(result.bytes);
  assert.deepEqual(readRecords(after.payload)[1].raw, readRecords(before.payload)[1].raw);
  assert.deepEqual(readRecords(after.payload)[2].raw, readRecords(before.payload)[2].raw);
  const oldFields = readRecords(g), newFields = readRecords(rawGraph(result.bytes));
  assert.deepEqual(newFields.at(-1).raw, oldFields.at(-1).raw, 'comment is unchanged');
  const oldVariable = oldFields.find(f => f.id === 6).data, newVariable = newFields.find(f => f.id === 6).data;
  for (const id of [3, 4, 5, 6, 7, 8]) {
    const old = optional(oldVariable, id, id === 4 ? 2 : 0);
    if (old) assert.deepEqual(old.raw, optional(newVariable, id, id === 4 ? 2 : 0)?.raw);
  }
});
test('multiple repairs and rename are applied atomically from the original', () => {
  const bytes = demo(), a = inspect(bytes);
  const ops = [{ kind: 'declare', graph: a.graphs[0].key, name: 'Score', type: 3 }, { kind: 'rename', graph: a.graphs[0].key, name: 'RoundTime', to: 'Timer' }, { kind: 'declare', graph: a.graphs[1].key, name: 'HasJoined', type: 4 }];
  const result = patch(bytes, ops);
  assert.equal(result.report.changes.length, 3);
  assert.equal(result.analysis.stats.repairs, 4);
  assert.throws(() => patch(bytes, [...ops, { kind: 'rename', graph: a.graphs[2].key, name: 'SelectedSlot', to: 'Slot' }]), /cannot be renamed/);
});
test('GIL stage wrappers, repeated GIA roots and dependencies are found and preserved', () => {
  const graphs = [graph({ nodes: [variableNode(1, 'Score')] }), graph({ id: 1073741826, nodes: [variableNode(1, 'Other')] })];
  for (const bytes of [container(f(10, 2, join(graphs.map(g => f(1, 2, f(1, 2, g))))), 2), container(join([asset(graphs[0]), asset(graphs[1])])), container(join([asset(graphs[0]), asset(graphs[1], 2)]))]) {
    assert.equal(inspect(bytes).graphs.length, 2);
    const result = declare(bytes);
    const path = inspect(bytes).graphs[1].path;
    assert.deepEqual(atPath(openContainer(result.bytes).payload, path), atPath(openContainer(bytes).payload, path));
  }
});
test('dynamic names are refused whether connections live on the input or output', () => {
  const edge = f(5, 2, join([f(1, 0, 2), f(2, 2, sig(4))]));
  const inputOwned = file({ nodes: [variableNode(1, 'Score', 3, 'Get', [edge]), simpleNode(2, 18)] });
  const source = join([simpleNode(2, 18), f(4, 2, join([f(1, 2, sig(4)), f(5, 2, join([f(1, 0, 1), f(2, 2, sig(3))]))]))]);
  const outputOwned = file({ nodes: [variableNode(1, 'Score'), source] });
  for (const bytes of [inputOwned, outputOwned]) {
    hasReason(bytes, /runtime/); assert.equal(first(bytes).findings[0].kind, 'dynamic');
    assert.throws(() => declare(bytes), /cannot be patched/);
  }
});
test('unresolved composites, unknown nodes and unsupported services cannot be patched', () => {
  const composite = withRecord(simpleNode(2, 18), 2, 2, loc(999, { origin: 10000, kind: 21002 }));
  for (const opts of [{ nodes: [variableNode(1, 'Score'), composite] }, { nodes: [variableNode(1, 'Score'), callNode(2, 424242)] }, { service: 20001, nodes: [variableNode(1, 'Score')] }]) {
    const bytes = file(opts); assert.ok(!first(bytes).findings.some(f => f.repairable)); assert.throws(() => declare(bytes), /cannot be patched|no longer matches/);
  }
});
test('public variables cannot be renamed', () => {
  const bytes = file({ variables: [join([declaration('RoundTime', 3), f(5, 0, 1)])] });
  assert.equal(first(bytes).variables[0].renameable, false);
  assert.throws(() => rename(bytes), /cannot be renamed/);
});
test('conflicting types, duplicate declarations and duplicate node IDs block edits', () => {
  for (const opts of [{ nodes: [variableNode(1, 'Score'), variableNode(2, 'Score', 4)] }, { nodes: [variableNode(1, 'Score'), variableNode(1, 'Other')] }, { nodes: [variableNode(1, 'Score')], variables: [declaration('Existing', 3), declaration('Existing', 3)] }, { nodes: [variableNode(1, 'Score')], variables: [declaration('Score', 4)] }]) {
    const bytes = file(opts); assert.ok(!first(bytes).findings.some(f => f.repairable)); assert.throws(() => declare(bytes), /cannot be patched|no longer matches/);
  }
});
test('duplicate graph identities are not independently patched', () => {
  const g = graph({ nodes: [variableNode(1, 'Score')] });
  const bytes = container(join([asset(g), asset(g, 2)]));
  hasReason(bytes, /more than once/); assert.throws(() => declare(bytes), /cannot be patched/);
});
test('type metadata mismatches are refused', () => {
  const n = variableNode(1, 'Score'), pin = readRecords(n).filter(f => f.id === 4)[1];
  const index = readRecords(n).findIndex(f => f.id === 4 && equal(f.data, pin.data));
  const altered = editPaths(n, [{ path: [index], bytes: withRecord(pin.data, 4, 0, 4) }]);
  hasReason(file({ nodes: [altered] }), /metadata disagrees/);
  const namePinIndex = readRecords(n).findIndex(f => f.id === 4);
  const namePin = readRecords(n)[namePinIndex].data;
  const value = required(namePin, 3);
  const conflicting = withRecord(namePin, 3, 2, join([value, f(102, 2, f(1, 0, 17))]));
  const conflictingNode = editPaths(n, [{ path: [namePinIndex], bytes: conflicting }]);
  hasReason(file({ nodes: [conflictingNode] }), /conflicting value storage/);
});
test('names cannot collide with a declaration, missing reference or another queued rename', () => {
  const bytes = demo(), key = first(bytes).key;
  assert.throws(() => rename(bytes, 'RoundTime', 'Score'), /already used/);
  assert.throws(() => rename(bytes, 'RoundTime', 'RoundTime'), /unchanged/);
  assert.throws(() => patch(bytes, [{ kind: 'rename', graph: key, name: 'RoundTime', to: 'X' }, { kind: 'rename', graph: key, name: 'RoundTime', to: 'Y' }]), /one change/);
  for (const name of ['', ' ', ' x', 'x ', 'x\n', 'x\0', '界'.repeat(43)]) assert.throws(() => validateName(name));
  assert.equal(validateName('界'.repeat(42)), '界'.repeat(42));
});
test('forged operation types and incorrect repair types do not produce output', () => {
  const bytes = file({ nodes: [variableNode(1, 'Score')] });
  assert.throws(() => declare(bytes, 'Score', 4), /no longer matches/);
  assert.throws(() => patch(bytes, [change(bytes, { kind: 'delete', name: 'Score' })]), /Unsupported change/);
  assert.throws(() => patch(bytes, [{ kind: 'declare', graph: 'bad', name: 'Score', type: 3 }]), /cannot be patched/);
});
test('bad headers, malformed protobuf and invalid edit paths fail closed', () => {
  const bytes = demo();
  for (const offset of [0, 4, 8, 12, 16, bytes.length - 1]) { const b = bytes.slice(); b[offset] ^= 1; assert.throws(() => inspect(b)); }
  assert.throws(() => inspect(container(Uint8Array.of(10, 100, 1))), /Truncated/);
  assert.throws(() => inspect(container(Uint8Array.of(0))), /field number/);
  assert.throws(() => inspect(container(Uint8Array.of(11))), /wire type/);
  assert.throws(() => editPaths(f(1, 2, new Uint8Array()), [{ path: [3], bytes: new Uint8Array() }]), /no longer exists/);
  assert.throws(() => editPaths(f(1, 2, f(1, 2, new Uint8Array())), [{ path: [0], bytes: new Uint8Array() }, { path: [0, 0], bytes: new Uint8Array() }]), /Overlapping/);
});
test('unrelated opaque content survives a real patch across varint length boundaries', () => {
  for (const size of [0, 127, 128, 16383, 16384]) {
    const opaque = f(90, 2, new Uint8Array(size).fill(0x80));
    const bytes = container(join([opaque, asset(graph({ nodes: [variableNode(1, 'Score')] })), opaque]));
    const out = declare(bytes).bytes;
    const records = readRecords(openContainer(out).payload);
    assert.deepEqual(records[0].raw, opaque); assert.deepEqual(records[2].raw, opaque);
    const h = new DataView(out.buffer); assert.equal(h.getUint32(0), out.length - 4); assert.equal(h.getUint32(16), out.length - 24);
  }
});

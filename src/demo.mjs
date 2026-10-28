// Hand-built synthetic data: no game export, account identifier or player save.
import { encodeRecord as f, concat as join, utf8 } from './protobuf.mjs';
import { declaration } from './graph.mjs';
export const loc = (id, { origin = 10001, service = 20000, kind = 22000 } = {}) => join([f(1, 0, origin), f(2, 0, service), f(3, 0, kind), f(5, 0, id)]);
export const sig = (kind, slot = 0) => join([f(1, 0, kind), f(2, 0, slot)]);
export function stringValue(name) {
  return join([f(1, 0, 5), f(2, 0, 1), f(4, 2, join([f(1, 0, 1), f(100, 2, f(1, 0, 6))])), f(105, 2, f(1, 2, utf8.encode(name)))]);
}
export function variableNode(id, name, type = 3, action = 'Get', extraPin = []) {
  const shells = { Get: 337, Set: 323 };
  const kernels = { Get: { 1: 337, 3: 339, 4: 340, 5: 341, 6: 342 }, Set: { 1: 328, 3: 323, 4: 325, 5: 324, 6: 326 } };
  const namePin = join([f(1, 2, sig(3)), f(2, 2, sig(3)), f(3, 2, stringValue(name)), f(4, 0, 6), ...extraPin]);
  const dataPin = join([f(1, 2, sig(action === 'Get' ? 4 : 3, action === 'Get' ? 0 : 1)), f(4, 0, type)]);
  return join([f(1, 0, id), f(2, 2, loc(shells[action])), f(3, 2, loc(kernels[action][type])), f(4, 2, namePin), f(4, 2, dataPin)]);
}
export const simpleNode = (id, shell) => join([f(1, 0, id), f(2, 2, loc(shell)), f(3, 2, loc(shell))]);
export function graph({ id = 1073741825, name = 'Round controller', nodes = [], variables = [], extra = [], service = 20000, kind = 21001 } = {}) {
  return join([f(1, 2, loc(id, { origin: 10000, service, kind })), f(2, 2, utf8.encode(name)), ...nodes.map(n => f(3, 2, n)), ...variables.map(v => f(6, 2, v)), ...extra]);
}
export function container(payload, type = 3) {
  const h = new Uint8Array(20), v = new DataView(h.buffer);
  [payload.length + 20, 1, 0x326, type, payload.length].forEach((n, i) => v.setUint32(i * 4, n));
  return join([h, payload, Uint8Array.of(0, 0, 6, 121)]);
}
export const asset = (g, root = 1) => f(root, 2, f(13, 2, f(1, 2, f(1, 2, g))));
export function compositeInterface(id, name, bodyId = id) {
  return join([f(4, 2, join([f(1, 2, loc(id, { kind: 22001 })), f(4, 2, loc(bodyId, { origin: 10000, kind: 21002 }))])), f(107, 2, f(1, 0, 1000)), f(200, 2, utf8.encode(name))]);
}
export const interfaceAsset = (i, root = 2) => f(root, 2, f(14, 2, f(1, 2, f(1, 2, i))));
export const callNode = (index, id, pins = []) => join([f(1, 0, index), f(2, 2, loc(id, { kind: 22001 })), ...pins.map(p => f(4, 2, p))]);
export const mapping = (external, node, internal = external) => f(4, 2, join([f(1, 2, sig(...external)), f(2, 0, node), f(3, 2, sig(...internal))]));
export function demo() {
  const a = graph({ nodes: [variableNode(1, 'Score'), variableNode(2, 'Score', 3, 'Set'), variableNode(3, 'RoundTime'), variableNode(4, 'RoundTime', 3, 'Set')], variables: [declaration('RoundTime', 3, 180)] });
  const b = graph({ id: 1073741826, name: 'Player welcome', nodes: [variableNode(1, 'WelcomeText', 6), variableNode(2, 'HasJoined', 4, 'Set')] });
  const c = graph({ id: 1073741827, name: 'Shared inventory', nodes: [variableNode(1, 'ItemCount'), simpleNode(2, 351)], variables: [declaration('SelectedSlot', 3)] });
  const d = graph({ id: 1073741828, name: 'Medal Equipment', service: 20005, nodes: [callNode(2, 1610612737), callNode(3, 1610612752)] });
  const e = graph({ id: 1610612737, name: 'Cache Player Entity', kind: 21002, nodes: [variableNode(32, 'PlayerEntity', 1, 'Set')] });
  const h = graph({ id: 1610612752, name: 'Cache EquipIdx', kind: 21002, nodes: [variableNode(8, 'EquipIdx', 3, 'Set')] });
  const edge = f(5, 2, join([f(1, 0, 2), f(2, 2, sig(4))]));
  const dynamic = graph({ id: 1073741829, name: 'Runtime UI binding', nodes: [variableNode(1, 'Slot', 3, 'Get', [edge]), simpleNode(2, 18)], variables: [declaration('Slot', 3)] });
  return container(join([asset(a), asset(b, 2), asset(c, 2), asset(d, 2), asset(e, 2), asset(h, 2), asset(dynamic, 2), interfaceAsset(compositeInterface(1610612737, 'Cache Player Entity')), interfaceAsset(compositeInterface(1610612752, 'Cache EquipIdx'))]));
}

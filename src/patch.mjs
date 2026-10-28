import { encodeRecord, concat, utf8, atPath, editPaths, rewrap, equal, required } from './protobuf.mjs';
import { TYPES, declaration, validateName, validateValue, defaultFor, displayValue, updateValue } from './values.mjs';
import { parseDocument, child } from './reader.mjs';
import { analyzeDocument } from './analyze.mjs';

export const VERSION = '0.3.0';
const fail = message => { throw new Error(message); };
export function patch(input, operations) {
  if (!Array.isArray(operations) || operations.length > 1000) fail('Choose at most 1,000 changes.');
  const doc = parseDocument(input), analysis = analyzeDocument(doc), groups = new Map(), changes = [];
  for (const op of operations) {
    if (!op || !['declare', 'rename', 'set-default'].includes(op.kind)) fail('Unsupported change.');
    const graph = analysis.graphs.find(g => g.key === op.graph);
    if (!graph || graph.composite || (op.kind !== 'set-default' && !graph.coverage.complete)) fail('This graph cannot be patched safely: reference coverage is incomplete.');
    if (!groups.has(graph.key)) groups.set(graph.key, { graph, ops: [] });
    const group = groups.get(graph.key);
    if (group.ops.some(old => old.name === op.name)) fail('Only one change per variable is allowed in a patch.');
    group.ops.push(op);
  }
  const edits = [];
  for (const { graph, ops } of groups.values()) {
    const occupied = new Set([...graph.variables.map(v => v.name), ...graph.references.map(r => r.name)]), targets = new Set();
    let bytes = atPath(doc.container.payload, graph.path); const inside = [], additions = [];
    for (const op of ops) {
      const refs = graph.references.filter(r => r.name === op.name);
      const base = { kind: op.kind, graph: graph.name, graphKey: graph.key, graphId: graph.identity.id, name: op.name, references: refs.length };
      if (op.kind === 'declare') {
        const finding = graph.findings.find(f => f.kind === 'missing' && f.name === op.name && f.repairable);
        if (!finding || finding.type !== op.type) fail('The selected repair no longer matches the file.');
        const value = validateValue(op.type, Object.hasOwn(op, 'value') ? op.value : defaultFor(op.type));
        additions.push(encodeRecord(6, 2, declaration(op.name, op.type, value)));
        changes.push({ ...base, type: TYPES[op.type], typeId: op.type, before: null, after: { name: op.name, initial: value, public: false }, default: displayValue(value), evidence: finding.evidence });
      } else {
        const v = graph.variables.find(v => v.name === op.name);
        if (!v) fail('The selected variable no longer exists.');
        const declarationBytes = atPath(bytes, v.path);
        if (op.kind === 'rename') {
          validateName(op.to);
          if (!v.renameable || op.name === op.to || occupied.has(op.to) || targets.has(op.to)) fail('The new name is unchanged, already used, or this variable cannot be renamed.');
          targets.add(op.to);
          inside.push({ path: [...v.path, child(declarationBytes, 2).index], bytes: utf8.encode(op.to) });
          for (const ref of refs) { if (!ref.direct || !ref.path) fail('A shared or forwarded reference cannot be renamed.'); inside.push({ path: ref.path, bytes: utf8.encode(op.to) }); }
          changes.push({ ...base, to: op.to, type: v.typeName, before: op.name, after: op.to });
        } else {
          if (!v.editable) fail('This declaration’s initial value cannot be edited safely.');
          const value = validateValue(v.type, op.value);
          if (value === v.initial.value) fail('The new initial value is unchanged.');
          inside.push({ path: [...v.path, child(declarationBytes, 4).index], bytes: updateValue(required(declarationBytes, 4), v.type, value) });
          changes.push({ ...base, type: v.typeName, typeId: v.type, before: v.initial.value, after: value, exposed: v.public });
        }
      }
    }
    for (const edit of inside) atPath(bytes, edit.path);
    bytes = concat([inside.length ? editPaths(bytes, inside) : bytes, ...additions]);
    edits.push({ path: graph.path, bytes });
  }
  const payload = edits.length ? editPaths(doc.container.payload, edits) : doc.container.payload;
  const output = rewrap(doc.container, payload), outputDoc = parseDocument(output), after = analyzeDocument(outputDoc);
  if (after.graphs.length !== analysis.graphs.length) fail('Validation failed: graph inventory changed.');
  for (const { graph, ops } of groups.values()) {
    const next = after.graphs.find(g => g.key === graph.key);
    if (!next || next.nodes !== graph.nodes || next.variables.length !== graph.variables.length + ops.filter(op => op.kind === 'declare').length) fail('Validation failed: graph structure changed unexpectedly.');
    if (next.coverage.complete !== graph.coverage.complete) fail('Validation failed: reference coverage changed unexpectedly.');
    for (const op of ops) {
      const name = op.kind === 'rename' ? op.to : op.name, variables = next.variables.filter(v => v.name === name);
      if (variables.length !== 1) fail('Validation failed: declaration was not written.');
      if (op.kind === 'rename' && next.references.some(r => r.name === op.name)) fail('Validation failed: a reference was not renamed.');
      if (next.references.filter(r => r.name === name).length !== graph.references.filter(r => r.name === op.name).length) fail('Validation failed: the reference count changed unexpectedly.');
      if (op.kind !== 'rename') {
        const expected = validateValue(variables[0].type, Object.hasOwn(op, 'value') ? op.value : defaultFor(op.type));
        if (!variables[0].initial.supported || variables[0].initial.value !== expected) fail('Validation failed: initial value did not round-trip.');
      }
    }
  }
  const untouched = analysis.graphs.filter(g => !groups.has(g.key));
  for (const graph of untouched) if (!equal(atPath(doc.container.payload, graph.path), atPath(outputDoc.container.payload, graph.path))) fail('Validation failed: an unrelated graph changed.');
  return { bytes: output, analysis: after, report: { tool: 'Miliastra Fix', version: VERSION, format: analysis.format, originalBytes: doc.container.bytes.length, patchedBytes: output.length, validation: { container: true, graphInventory: true, postconditions: true, untouchedGraphs: untouched.length, nativeEditorImport: 'not-tested' }, summary: { changedGraphs: groups.size, compositeBodiesChanged: 0, repairsBefore: analysis.stats.repairs, repairsAfter: after.stats.repairs }, changes } };
}

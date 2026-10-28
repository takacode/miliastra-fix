import { parseDocument, locatorKey } from './reader.mjs';
import { equal } from './protobuf.mjs';
export function compareFiles(beforeInput, afterInput) {
  const before = parseDocument(beforeInput), after = parseDocument(afterInput);
  if (before.container.format !== after.container.format) throw new Error('Compare two files of the same format.');
  const index = document => {
    const result = new Map();
    for (const graph of document.graphs) {
      const key = locatorKey(graph.identity);
      if (result.has(key)) throw new Error('Comparison needs unique graph identities in each file.');
      result.set(key, graph);
    }
    return result;
  };
  const left = index(before), right = index(after), changes = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key), b = right.get(key);
    if (a && b && equal(a.bytes, b.bytes)) continue;
    const variables = [];
    for (const name of new Set([...(a?.variables || []).map(v => v.name), ...(b?.variables || []).map(v => v.name)])) {
      const av = a?.variables.find(v => v.name === name), bv = b?.variables.find(v => v.name === name);
      if (av && bv && equal(av.bytes, bv.bytes)) continue;
      const summary = v => v ? { type: v.typeName, public: v.public, initial: v.initial.label } : null;
      variables.push({ name, before: summary(av), after: summary(bv) });
    }
    changes.push({ identity: key, name: b?.name || a.name, status: !a ? 'added' : !b ? 'removed' : 'changed', beforeName: a?.name, afterName: b?.name, beforeNodes: a?.nodeRecords.length || 0, afterNodes: b?.nodeRecords.length || 0, variables });
  }
  return { identical: equal(before.container.bytes, after.container.bytes), format: before.container.format, beforeBytes: before.container.bytes.length, afterBytes: after.container.bytes.length, unchangedGraphs: [...left.keys()].filter(key => right.has(key) && equal(left.get(key).bytes, right.get(key).bytes)).length, changes, scope: 'Graph records and their declarations. Changes to scenes, resources, mounts or other file sections are not itemized.' };
}

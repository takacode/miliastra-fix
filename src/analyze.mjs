import { optional, required, number, string, text, readRecords } from './protobuf.mjs';
import { observedKernelTypes } from './kernels.mjs';
import { TYPES, SCALARS, serverType, validateName, valueMatchesType } from './values.mjs';
import { parseDocument, locatorKey, signatureKey, endpointKey, child, serverServices } from './reader.mjs';

// Built-in system nodes that address graph variables by name.
const SET_VARIABLE = 323, GET_VARIABLE = 337, VARIABLE_CHANGED = 351;
const isBuiltIn = l => !!l && l.origin === 10001 && l.service === 20000 && l.kind === 22000;
const samePin = (a, b) => a.kind === b.kind && a.slot === b.slot;
const nodeLabel = n => `Node #${n.id} (type ${n.shell.id})`;
const unique = items => [...new Set(items)];
const valuePin = node => node.shell.id === GET_VARIABLE ? { kind: 4, slot: 0 } : { kind: 3, slot: 1 };
const kernelKey = node => `${node.shell.id}:${node.kernel?.id}`;
function storedText(pin) {
  try {
    const value = optional(pin.bytes, 3), str = value && optional(value.data, 105), inner = str && optional(str.data, 1);
    return inner ? text(inner.data) : undefined;
  } catch { return undefined; }
}
function interfaceFor(doc, node) {
  const list = doc.interfaceIndex.get(locatorKey(node.shell)) || [];
  if (list.length !== 1 || list[0].errors.length) return null;
  const i = list[0];
  if (node.kernel && i.kernel && locatorKey(node.kernel) !== locatorKey(i.kernel)) return null;
  for (const p of node.pins) if (p.uid !== undefined && [1, 2, 3, 4].includes(p.kind)) {
    const definition = i.pins.find(d => samePin(d, p));
    if (!definition || p.uid !== definition.uid) return null;
  }
  return i;
}
function bodyFor(doc, node) {
  const i = interfaceFor(doc, node);
  if (!i || i.category !== 1000 || !i.body) return null;
  const graphs = doc.graphIndex.get(locatorKey(i.body)) || [];
  return graphs.length === 1 && graphs[0].identity?.kind === 21002 && serverServices.has(graphs[0].identity?.service) ? { graph: graphs[0], interface: i } : null;
}
function literal(graph, node, pin) {
  const value = optional(pin.bytes, 3), str = value && optional(value.data, 105);
  if (!str || !optional(str.data, 1)) return { reason: 'No literal string is stored on this input.' };
  if ((pin.type && pin.type !== 6) || (serverType(value.data) && serverType(value.data) !== 6) || readRecords(value.data).some(f => f.id >= 101 && f.id <= 112 && f.id !== 105)) return { reason: 'The name input has conflicting value storage or type metadata.', invalid: true };
  const name = string(str.data, 1);
  try { validateName(name); } catch (error) { return { reason: error.message, invalid: true }; }
  return { name, path: [...graph.path, ...pin.path, child(pin.bytes, 3).index, child(value.data, 105).index, child(str.data, 1).index], graph: graph.key, node: node.id };
}
function resolveInput(doc, context, node, pin, visited = new Set(), depth = 0) {
  if (!node || depth > 64) return { reason: 'The name connection is cyclic or exceeds the 64-step trace limit.' };
  const key = `${context.id}/${node.id}/${signatureKey(pin)}/in`;
  if (visited.has(key)) return { reason: 'The name connection is cyclic.' };
  visited = new Set(visited).add(key);
  // Exposed composite inputs override the body pin's stored fallback value.
  const mapped = context.graph.mappings.filter(m => m.node === node.id && samePin(m.internal, pin) && m.external.kind === 3);
  if (mapped.length) {
    if (mapped.length !== 1 || !context.parent) return { reason: 'This name comes from a composite input without one resolved caller.' };
    return resolveInput(doc, context.parent, context.call, mapped[0].external, visited, depth + 1);
  }
  const incoming = context.graph.incoming.get(endpointKey(node.id, pin)) || [];
  if (incoming.length > 1) return { reason: 'Multiple wires supply this name input.', invalid: true };
  if (incoming.length) return resolveOutput(doc, context, incoming[0], visited, depth + 1);
  const physical = node.pins.filter(p => samePin(p, pin));
  if (physical.length !== 1) return { reason: 'The variable node has no unambiguous literal name input.' };
  return literal(context.graph, node, physical[0]);
}
function resolveOutput(doc, context, endpoint, visited, depth) {
  const node = context.graph.byId.get(endpoint.node);
  if (!node || depth > 64) return { reason: 'The name source is missing or exceeds the trace limit.' };
  const body = bodyFor(doc, node);
  if (body) {
    const mapped = body.graph.mappings.filter(m => samePin(m.external, endpoint));
    if (mapped.length !== 1) return { reason: `Composite “${body.interface.name}” has no unique output mapping for this name.` };
    const inner = { graph: body.graph, parent: context, call: node, id: `${context.id}/${node.id}` }, map = mapped[0];
    return map.internal.kind === 3 ? resolveInput(doc, inner, body.graph.byId.get(map.node), map.internal, visited, depth + 1) : resolveOutput(doc, inner, { node: map.node, ...map.internal }, visited, depth + 1);
  }
  // A variable's initial value is not proof of its runtime value. Do not constant-fold mutable reads.
  return { reason: `${nodeLabel(node)} computes this name at runtime.` };
}
// The editor records each Get/Set node's value type on its value pin. Kernels seen in editor-saved stages
// must agree with that type, a scalar type requires such a kernel, and one kernel cannot carry two types in a file.
function referenceType(node, kernelTypes) {
  const values = node.pins.filter(p => samePin(p, valuePin(node)));
  const recorded = unique(values.map(p => p.type));
  const type = recorded.length === 1 ? recorded[0] : 0;
  const observed = observedKernelTypes[node.shell.id]?.[node.kernel?.id];
  let error = null;
  if (!isBuiltIn(node.kernel) || !type) error = 'The graph-variable value type is unresolved.';
  else if (observed ? observed !== type : SCALARS.includes(type)) error = 'Node type metadata disagrees with its kernel type.';
  else if (kernelTypes.get(kernelKey(node))?.size > 1) error = 'Nodes sharing this kernel record different value types.';
  for (const pin of node.pins) if (pin.kernel && !samePin(pin, pin.kernel)) error = 'Graph-variable pin kernel signature disagrees with its shell signature.';
  if (values.length > 1) error = 'The variable node has duplicate value pins.';
  for (const pin of values) {
    const value = optional(pin.bytes, 3);
    if (value && !valueMatchesType(value.data, type)) error = 'Node type metadata disagrees with its kernel type.';
  }
  return { type, error };
}
function kernelTypesIn(doc) {
  const seen = new Map();
  for (const g of doc.graphs) for (const node of g.nodeRecords) {
    if (!isBuiltIn(node.shell) || ![SET_VARIABLE, GET_VARIABLE].includes(node.shell.id)) continue;
    for (const pin of node.pins) if (samePin(pin, valuePin(node)) && pin.type) {
      if (!seen.has(kernelKey(node))) seen.set(kernelKey(node), new Set());
      seen.get(kernelKey(node)).add(pin.type);
    }
  }
  return seen;
}
function publicGraph(g) {
  return { key: g.key, name: g.name, path: g.path, source: g.source, category: g.category, composite: g.composite, identity: g.identity, nodes: g.nodeRecords.length, expandedNodes: 0, variables: g.variables.map(({ bytes, ...v }) => ({ ...v, references: 0, renameable: false, editable: false })), references: [], findings: [], blockers: [], renameBlockers: [], dependencies: [], callers: [], coverage: { complete: false, gaps: [], contexts: 0 } };
}
export function analyzeDocument(doc) {
  const graphs = doc.graphs.map(publicGraph), byKey = new Map(graphs.map(g => [g.key, g])), kernelTypes = kernelTypesIn(doc);
  for (const original of doc.graphs) {
    const g = byKey.get(original.key), supported = original.identity?.origin === 10000 && original.identity?.kind === 21001 && serverServices.has(original.identity?.service) && !original.composite;
    if (!supported) g.blockers.push(original.composite ? 'Composite bodies share their caller’s variable scope. Select a calling graph to repair declarations.' : 'Editing is supported for server Entity, Item, Status and Class graphs.');
    g.blockers.push(...original.errors);
    if (original.composite || !original.identity || !serverServices.has(original.identity.service)) continue;
    const gaps = new Map(), refIndex = new Map(), listeners = [], dependencies = new Map(), mentions = new Map(); let remaining = 50000;
    const addGap = (code, reason, context, node) => {
      const key = `${code}/${context.graph.key}/${node?.id || 0}/${reason}`;
      if (!gaps.has(key)) gaps.set(key, { code, reason, graph: context.graph.name, graphKey: context.graph.key, node: node?.id, path: context.chain });
    };
    function visit(context, stack) {
      g.coverage.contexts++;
      if (stack.has(context.graph.key) || stack.size >= 32) { addGap('cycle', 'Composite recursion or nesting beyond 32 levels prevents a complete scan.', context); return; }
      if (remaining <= 0) { addGap('limit', 'Expanded scan exceeds 50,000 node visits for this owner graph.', context); return; }
      stack = new Set(stack).add(context.graph.key);
      for (const reason of context.graph.errors) addGap('encoding', reason, context);
      for (const node of context.graph.nodeRecords) {
        if (--remaining < 0) { addGap('limit', 'Expanded scan exceeds 50,000 node visits for this owner graph.', context); break; }
        g.expandedNodes++;
        const shell = node.shell, builtIn = isBuiltIn(shell);
        if (builtIn && [SET_VARIABLE, GET_VARIABLE].includes(shell.id)) {
          const { type, error } = referenceType(node, kernelTypes);
          if (error) addGap('type', error, context, node);
          const resolved = resolveInput(doc, context, node, { kind: 3, slot: 0 });
          if (resolved.name === undefined) { addGap(resolved.invalid ? 'encoding' : 'dynamic', resolved.reason, context, node); continue; }
          const refKey = `${context.graph.key}/${node.id}/${resolved.name}/${type}`;
          if (!refIndex.has(refKey)) {
            const direct = context.graph.key === original.key && resolved.graph === original.key && resolved.node === node.id && !(original.incoming.get(endpointKey(node.id, { kind: 3, slot: 0 })) || []).length;
            refIndex.set(refKey, { name: resolved.name, type, node: node.id, action: shell.id === GET_VARIABLE ? 'Get' : 'Set', graph: context.graph.name, graphKey: context.graph.key, direct, path: direct ? resolved.path.slice(original.path.length) : null, source: { graph: resolved.graph, node: resolved.node }, occurrences: 0, callPaths: [] });
          }
          const ref = refIndex.get(refKey); ref.occurrences++;
          if (ref.callPaths.length < 8) ref.callPaths.push(context.chain);
          continue;
        }
        if (builtIn && shell.id === VARIABLE_CHANGED) listeners.push({ graph: context.graph.name, node: node.id });
        // Other built-in nodes (including composite entry/exit stubs) do not address graph variables by name.
        // Text they store is still recorded, because a rename would leave it unchanged.
        if (builtIn) {
          for (const pin of node.pins) {
            const stored = pin.kind === 3 && storedText(pin);
            if (stored && !mentions.has(stored)) mentions.set(stored, node.id);
          }
          continue;
        }
        const i = interfaceFor(doc, node);
        if (i && [1001, 1002, 1003, 1004, 1005].includes(i.category)) continue;
        const body = bodyFor(doc, node);
        if (!body) { addGap('unknown', `Unknown node or missing composite definition at #${node.id}.`, context, node); continue; }
        const step = { graph: context.graph.name, graphKey: context.graph.key, node: node.id, composite: body.interface.name, bodyKey: body.graph.key };
        if (!dependencies.has(body.graph.key)) dependencies.set(body.graph.key, { key: body.graph.key, name: body.interface.name, calls: 0 });
        dependencies.get(body.graph.key).calls++;
        const target = byKey.get(body.graph.key);
        if (target && !target.callers.some(c => c.key === g.key)) target.callers.push({ key: g.key, name: g.name });
        visit({ graph: body.graph, parent: context, call: node, id: `${context.id}/${node.id}`, chain: [...context.chain, step] }, stack);
      }
    }
    visit({ graph: original, parent: null, id: original.key, chain: [] }, new Set());
    g.references = [...refIndex.values()]; g.dependencies = [...dependencies.values()]; g.coverage.gaps = [...gaps.values()];
    g.coverage.complete = !gaps.size && !g.blockers.length;
    if (gaps.size) g.blockers.push(...unique([...gaps.values()].map(gap => gap.reason)));
    g.renameBlockers = [...g.blockers, ...(listeners.length ? ['A graph-variable-change listener can compare names outside the direct name inputs.'] : [])];
    const grouped = new Map();
    for (const ref of g.references) { if (!grouped.has(ref.name)) grouped.set(ref.name, []); grouped.get(ref.name).push(ref); }
    for (const [name, refs] of grouped) {
      const declarations = g.variables.filter(v => v.name === name), types = unique(refs.map(r => r.type));
      const type = types.length === 1 ? types[0] : 0;
      const evidence = refs.map(({ path, source, ...ref }) => ref);
      for (const v of declarations) v.references = refs.length;
      const conflict = !types.includes(0) && (types.length > 1 || declarations.some(v => v.type !== type));
      if (conflict) g.findings.push({ kind: 'conflict', severity: 'error', name, type, title: `Conflicting types for “${name}”`, detail: 'The declaration and reference types must agree. Inspect the affected nodes before changing their type.', evidence, nodes: refs.map(r => r.node), repairable: false });
      else if (!declarations.length) g.findings.push({ kind: 'missing', severity: 'warning', name, type, title: `“${name}” is not declared`, detail: `${refs.length} unique ${refs.every(r => r.direct) ? 'direct ' : ''}reference${refs.length === 1 ? ' uses' : 's use'} ${TYPES[type] || 'an unresolved type'}${refs.some(r => !r.direct) ? ' through this graph’s composite call chain' : ''}.`, evidence, nodes: refs.map(r => r.node), repairable: SCALARS.includes(type) && g.coverage.complete });
      if (conflict) {
        for (const v of declarations) v.conflict = true;
        g.renameBlockers.push(`Conflicting reference types for “${name}”.`);
      }
    }
    for (const gap of gaps.values()) g.findings.push({ kind: gap.code === 'dynamic' ? 'dynamic' : 'coverage', severity: 'info', title: gap.code === 'dynamic' ? 'Runtime-computed variable name' : 'Incomplete reference coverage', detail: gap.reason, node: gap.node, evidence: [{ node: gap.node, graph: gap.graph, graphKey: gap.graphKey, callPaths: [gap.path], occurrences: 1 }], repairable: false });
    for (const v of g.variables) {
      const refs = grouped.get(v.name) || [];
      v.renameReasons = [...g.renameBlockers, ...(v.public ? ['Exposed variables can have external overrides.'] : []), ...(refs.some(r => !r.direct) ? ['This name is used through a composite or forwarded input. Renaming could affect shared callers.'] : []), ...(mentions.has(v.name) ? [`Node #${mentions.get(v.name)} stores this name as text. Renaming would leave that text unchanged.`] : [])];
      v.renameable = !v.renameReasons.length;
      // A default is a declaration-local value, so unrelated dynamic references do not stop an explicit default edit.
      v.editable = supported && !original.errors.length && v.initial.supported && !v.conflict;
      if (!v.references) g.findings.push({ kind: 'unused', severity: 'info', name: v.name, title: `No resolved references to “${v.name}”`, detail: 'Informational only. External scripts or unresolved runtime names may still use this variable.', repairable: false });
    }
  }
  for (const g of graphs) g.findings.forEach((f, index) => { f.id = `${g.key}:${index}`; f.graphKey = g.key; f.graphName = g.name; });
  const findings = graphs.flatMap(g => g.findings);
  return { format: doc.container.format, size: doc.container.bytes.length, graphs, stats: { graphs: graphs.length, ownerGraphs: graphs.filter(g => !g.composite).length, composites: graphs.filter(g => g.composite).length, nodes: graphs.reduce((n, g) => n + g.nodes, 0), variables: graphs.reduce((n, g) => n + g.variables.length, 0), repairs: findings.filter(f => f.repairable).length, findings: findings.length, errors: findings.filter(f => f.severity === 'error').length, completeGraphs: graphs.filter(g => g.coverage.complete).length } };
}
export function inspect(input) { return analyzeDocument(parseDocument(input)); }

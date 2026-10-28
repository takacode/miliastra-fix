// Records the value type that editor-saved files store on graph-variable Get/Set nodes, per kernel.
// Usage: node tools/observe-kernels.mjs <stage.gil|asset.gia>... > src/kernels.mjs
// Inputs are only read. The output lists kernel IDs and type IDs; it contains no names or paths.
import fs from 'node:fs';
import { parseDocument, serverServices } from '../src/reader.mjs';

const VARIABLE_NODES = { 323: { kind: 3, slot: 1 }, 337: { kind: 4, slot: 0 } };
const builtIn = l => l && l.origin === 10001 && l.service === 20000 && l.kind === 22000;
const files = process.argv.slice(2);
if (!files.length) throw new Error('Usage: node tools/observe-kernels.mjs <stage.gil|asset.gia>...');

const seen = {}; let nodes = 0;
for (const file of files) {
  for (const graph of parseDocument(fs.readFileSync(file)).graphs) {
    if (!graph.identity || !serverServices.has(graph.identity.service)) continue;
    for (const node of graph.nodeRecords) {
      const value = VARIABLE_NODES[node.shell.id];
      if (!value || !builtIn(node.shell) || !builtIn(node.kernel)) continue;
      for (const pin of node.pins) if (pin.kind === value.kind && pin.slot === value.slot && pin.type) {
        ((seen[node.shell.id] ??= {})[node.kernel.id] ??= new Set()).add(pin.type);
      }
      nodes++;
    }
  }
}
const table = {};
for (const [shell, kernels] of Object.entries(seen)) for (const [kernel, types] of Object.entries(kernels)) {
  if (types.size !== 1) throw new Error(`Kernel ${kernel} on node type ${shell} was observed with several value types.`);
  (table[shell] ??= {})[kernel] = [...types][0];
}
const pairs = Object.values(table).reduce((n, k) => n + Object.keys(k).length, 0);
process.stdout.write(`// Graph-variable kernel value types observed in editor-saved stages (${pairs} kernels, ${nodes} nodes).
// Regenerate with tools/observe-kernels.mjs. Every repairable scalar type must appear for both Get and Set.
export const observedKernelTypes = ${JSON.stringify(table)};
`);

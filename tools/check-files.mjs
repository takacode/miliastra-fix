// Optional read-only local integration check. Never stores or prints raw export data.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { inspect, patch } from '../src/graph.mjs';
const paths = process.argv.slice(2);
if (!paths.length) { console.log('Usage: npm run verify:files -- <existing.gil> <existing.gia> …'); process.exit(0); }
for (const file of paths) {
  const bytes = await fs.readFile(file), analysis = inspect(bytes), result = patch(bytes, []);
  assert.deepEqual(Buffer.from(result.bytes), bytes, 'No-op round trip must preserve every byte');
  let exercised = false;
  for (const graph of analysis.graphs) {
    const variable = graph.variables.find(v => v.renameable);
    if (!variable) continue;
    const to = 'MiliastraFix_Test_' + variable.name;
    const edited = patch(bytes, [{ kind: 'rename', graph: graph.key, name: variable.name, to }]);
    const restored = patch(edited.bytes, [{ kind: 'rename', graph: graph.key, name: to, to: variable.name }]);
    assert.deepEqual(Buffer.from(restored.bytes), bytes, 'Rename and reverse must preserve the original bytes');
    exercised = true; break;
  }
  console.log(`${path.basename(file)}: ${analysis.format}, ${analysis.stats.graphs} graphs, ${analysis.stats.nodes} physical nodes; exact no-op${exercised ? ', rename and reverse' : ''} passed. No file written.`);
}

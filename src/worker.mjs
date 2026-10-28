import { inspect, patch } from './graph.mjs';
import { sha256, createRecipe, importRecipe } from './recipe.mjs';
import { compareFiles } from './compare.mjs';
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, progress: data.action === 'inspect' ? 'Tracing graph variables and composite callers…' : 'Checking file and change preconditions…' });
    if (data.action === 'inspect') self.postMessage({ id: data.id, result: { ...inspect(data.bytes), sha256: await sha256(data.bytes) } });
    else if (data.action === 'patch') {
      const result = patch(data.bytes, data.operations);
      self.postMessage({ id: data.id, progress: 'Verifying the export and calculating file fingerprints…' });
      result.report.originalSha256 = await sha256(data.bytes);
      result.report.patchedSha256 = await sha256(result.bytes);
      self.postMessage({ id: data.id, result }, [result.bytes.buffer]);
    } else if (data.action === 'export-plan') self.postMessage({ id: data.id, result: await createRecipe(data.bytes, data.operations) });
    else if (data.action === 'import-plan') self.postMessage({ id: data.id, result: await importRecipe(data.bytes, data.recipe) });
    else if (data.action === 'compare') self.postMessage({ id: data.id, result: compareFiles(data.bytes, data.other) });
    else throw new Error('Unknown worker action.');
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};

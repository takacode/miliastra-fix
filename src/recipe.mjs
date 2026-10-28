import { patch, VERSION } from './patch.mjs';
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function createRecipe(bytes, operations) {
  return { format: 'miliastra-fix-plan', schema: 1, toolVersion: VERSION, sourceSha256: await sha256(bytes), operations: cleanOperations(operations) };
}
function cleanOperations(operations) {
  if (!Array.isArray(operations) || operations.length > 1000) throw new Error('A plan must contain at most 1,000 operations.');
  return operations.map(op => {
    if (!op || typeof op !== 'object' || !['declare', 'rename', 'set-default'].includes(op.kind) || typeof op.graph !== 'string' || typeof op.name !== 'string') throw new Error('The plan contains an invalid operation.');
    const clean = { kind: op.kind, graph: op.graph, name: op.name };
    if (op.kind === 'declare') clean.type = op.type;
    if (op.kind === 'rename') clean.to = op.to;
    if (Object.hasOwn(op, 'value')) clean.value = op.value;
    return clean;
  });
}
export async function importRecipe(bytes, recipe) {
  if (!recipe || recipe.format !== 'miliastra-fix-plan' || recipe.schema !== 1) throw new Error('This is not a supported Miliastra Fix plan.');
  if (recipe.sourceSha256 !== await sha256(bytes)) throw new Error('This plan belongs to a different file. Open the exact original it was made for.');
  const operations = cleanOperations(recipe.operations);
  patch(bytes, operations); // Revalidate every precondition; never trust imported approval flags.
  return operations;
}

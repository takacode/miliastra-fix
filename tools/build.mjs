import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist');
// Only this project's resolved build directory may be removed.
if (path.dirname(output) !== path.resolve(root)) throw new Error('Invalid build directory.');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const name of ['index.html', 'style.css', 'mark.svg', 'src', 'README.md', 'CHANGELOG.md', 'LICENSE', 'docs']) await fs.cp(path.join(root, name), path.join(output, name), { recursive: true });
await fs.writeFile(path.join(output, '.nojekyll'), '');
console.log('Built dist/ — static files, relative paths, no backend.');

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const components = Object.entries(lock.packages ?? {}).filter(([path, value]) => path && value.version).map(([path, value]) => {
  const name = path.replace(/^node_modules\//u, '');
  return { type: 'library', name, version: value.version, licenses: [{ license: { id: value.license ?? 'NOASSERTION' } }], purl: `pkg:npm/${encodeURIComponent(name)}@${value.version}` };
});
components.push(
  { type: 'container', name: 'n8n', version: '2.30.5', hashes: [{ alg: 'SHA-256', content: '450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f' }] },
  { type: 'container', name: 'postgres', version: '17.10-alpine', hashes: [{ alg: 'SHA-256', content: '742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193' }] },
  { type: 'container', name: 'caddy', version: '2.11.4-alpine', hashes: [{ alg: 'SHA-256', content: '5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648' }] },
);
components.sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
const bom = { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, metadata: { component: { type: 'application', name: 'workoutreach', version: '0.1.0' } }, components };
await mkdir(join(root, 'sbom'), { recursive: true });
await writeFile(join(root, 'sbom/workoutreach.cdx.json'), `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ gate: 'sbom', ok: true, components: components.length, path: 'sbom/workoutreach.cdx.json' }, null, 2));

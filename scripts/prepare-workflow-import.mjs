import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'n8n/workflows');
const target = join(root, 'artifacts/workflow-import');
await mkdir(target, { recursive: true });
const files = (await readdir(source)).filter((name) => name.endsWith('.json')).sort();
for (const file of files) {
  const workflow = JSON.parse(await readFile(join(source, file), 'utf8'));
  workflow.id = `wo${createHash('sha256').update(workflow.name).digest('hex').slice(0, 14)}`;
  await writeFile(join(target, file), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({ gate: 'workflow-import-preparation', ok: true, source: 'n8n/workflows', target: 'artifacts/workflow-import', files: files.length }));

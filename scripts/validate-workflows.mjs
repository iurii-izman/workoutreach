import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'n8n/workflows');
const expected = ['01_telegram_ingest', '02_analyze_company', '03_render_review', '04_telegram_actions', '90_error_handler'];
const errors = [];
const workflows = [];
for (const file of (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()) {
  const raw = await readFile(join(directory, file), 'utf8');
  const workflow = JSON.parse(raw);
  workflows.push(workflow);
  if (workflow.active !== false) errors.push(`${file}: active must be false`);
  if (workflow.id || workflow.pinData || workflow.staticData || workflow.credentials) errors.push(`${file}: runtime metadata present`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) errors.push(`${file}: no nodes`);
  for (const node of workflow.nodes ?? []) {
    if (node.id || node.credentials) errors.push(`${file}/${node.name}: instance or credential id present`);
    if (['n8n-nodes-base.executeCommand', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.emailSend'].includes(node.type)) errors.push(`${file}/${node.name}: forbidden node`);
    const serialized = JSON.stringify(node.parameters ?? {});
    if (/\$env|process\.env/iu.test(serialized)) errors.push(`${file}/${node.name}: environment access in node`);
  }
}
for (const name of expected) if (!workflows.some((workflow) => workflow.name === name)) errors.push(`missing workflow ${name}`);
const analysis = workflows.find((workflow) => workflow.name === '02_analyze_company');
const openAi = analysis?.nodes.filter((node) => node.type === '@n8n/n8n-nodes-langchain.openAi') ?? [];
if (openAi.length !== 2) errors.push('02_analyze_company: exactly two OpenAI nodes required');
for (const node of openAi) {
  if (node.parameters.store !== false || node.parameters.outputFormat !== 'json_schema' || node.parameters.tools?.length !== 0) errors.push(`${node.name}: unsafe OpenAI contract`);
  if (node.disabled !== true) errors.push(`${node.name}: must remain disabled until credential/eval gate`);
}
const actions = workflows.find((workflow) => workflow.name === '04_telegram_actions');
if (!JSON.stringify(actions).includes('MOCK_SEND_BLOCKED') || actions.nodes.some((node) => node.type === 'n8n-nodes-base.postgres')) errors.push('04_telegram_actions: mock action contract invalid');

if (errors.length) {
  console.error(JSON.stringify({ gate: 'workflow-validator', ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'workflow-validator', ok: true, workflows: workflows.map((workflow) => workflow.name) }, null, 2));

import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commands = [
  ['greenfield', ['node', 'scripts/greenfield-guard.mjs']],
  ['secret-scan', ['node', 'scripts/secret-scan.mjs']],
  ['license-scan', ['node', 'scripts/license-scan.mjs']],
  ['workflow-validator', ['node', 'scripts/validate-workflows.mjs']],
  ['preflight', ['node', 'scripts/preflight.mjs', '--mode=ci']],
  ['tests', ['node', '--test']],
  ['sbom', ['node', 'scripts/generate-sbom.mjs']],
  ['dry-run', ['node', 'scripts/dry-run.mjs']],
];
const results = [];
for (const [name, [command, ...args]] of commands) {
  const run = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, LIVE_SEND_ENABLED: 'false', MAIL_TRANSPORT: 'disabled' } });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  results.push({ name, ok: run.status === 0, exitCode: run.status });
  if (run.status !== 0) break;
}
await mkdir(join(root, 'artifacts/evidence'), { recursive: true });
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const evidence = { generated_at: new Date().toISOString(), git_commit: git, live_send_enabled: false, results };
await writeFile(join(root, 'artifacts/evidence/verification.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
if (results.some((result) => !result.ok)) process.exit(1);
console.log(JSON.stringify({ gate: 'verify', ok: true, evidence: 'artifacts/evidence/verification.json' }, null, 2));

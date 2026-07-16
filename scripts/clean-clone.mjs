import { rm, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'artifacts/clean-clone');
const rel = relative(root, target);
if (rel.startsWith('..') || rel === '') throw new Error('clean clone target escaped repository root');
await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, LIVE_SEND_ENABLED: 'false', MAIL_TRANSPORT: 'disabled' } });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? `exit ${result.status}`}`);
}

run('git', ['clone', '--local', '--no-hardlinks', '.', target]);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required for cross-platform clean-clone verification');
run(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], target);
run(process.execPath, [npmCli, 'run', 'verify'], target);
const evidence = { ok: true, source: '.', target: 'artifacts/clean-clone', donor_access: false };
await writeFile(join(root, 'artifacts/evidence/clean-clone.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ gate: 'clean-clone', ...evidence }, null, 2));

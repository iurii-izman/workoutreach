import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRepoEntries } from './lib/repo-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const findings = [];
const patterns = [
  ['openai_key', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gu],
  ['telegram_token', /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/gu],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ['aws_access_key', /\bAKIA[A-Z0-9]{16}\b/gu],
];

for (const entry of (await listRepoEntries(root)).filter((item) => item.stat.isFile())) {
  if (/^\.env(?:\.|$)/u.test(entry.relative) && entry.relative !== '.env.example') findings.push({ file: entry.relative, kind: 'env_file' });
  const buffer = await readFile(entry.path);
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');
  for (const [kind, pattern] of patterns) if (pattern.test(text)) findings.push({ file: entry.relative, kind });
}

if (findings.length) {
  console.error(JSON.stringify({ gate: 'secret-scan', ok: false, findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'secret-scan', ok: true }, null, 2));

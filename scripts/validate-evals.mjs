import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl } from '../n8n/code/lib/url-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(root, 'evals/career-kz/calibration.v1.json');
const dataset = JSON.parse(await readFile(path, 'utf8'));
const errors = [];

if (dataset.version !== 'career-kz-calibration.v1') errors.push('unexpected dataset version');
if (dataset.campaign_type !== 'career_outreach' || dataset.owner_approved !== true) errors.push('campaign approval boundary invalid');
if (dataset.max_targets !== 10) errors.push('calibration limit must remain 10');
if (!Array.isArray(dataset.targets) || dataset.targets.length < 1 || dataset.targets.length > dataset.max_targets) errors.push('target count outside calibration limit');

const ids = new Set();
const hostnames = new Set();
for (const target of dataset.targets ?? []) {
  if (!/^kz-cal-[0-9]{3}$/u.test(target.id) || ids.has(target.id)) errors.push('invalid or duplicate target id');
  ids.add(target.id);
  if (target.enabled !== true || typeof target.provenance !== 'string' || target.provenance.length < 3) errors.push(`invalid target metadata: ${target.id}`);
  try {
    const url = normalizeUrl(target.url);
    if (hostnames.has(url.hostname)) errors.push(`duplicate target hostname: ${url.hostname}`);
    hostnames.add(url.hostname);
  } catch {
    errors.push(`unsafe target URL: ${target.id}`);
  }
  if ('email' in target || 'phone' in target || 'contact' in target) errors.push(`contact data is forbidden in eval seed: ${target.id}`);
}

if (errors.length) {
  console.error(JSON.stringify({ gate: 'eval-dataset', ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'eval-dataset', ok: true, version: dataset.version, targets: dataset.targets.length, limit: dataset.max_targets }, null, 2));

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureFetcher, createModelStub } from '../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, loadOfferProfile } from '../n8n/code/lib/pipeline.mjs';
import { asSafeResult } from '../n8n/code/lib/errors.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const result = await analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile: await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml'),
    personalizationMode: 'off',
    seed: 'telegram-update-1001',
  });
  await mkdir(join(root, 'artifacts/evidence'), { recursive: true });
  await writeFile(join(root, 'artifacts/evidence/dry-run.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(result.telegram_preview.text);
  console.log('\nEVIDENCE');
  console.log(JSON.stringify({ job_id: result.job_id, safety: result.safety, evidence: result.evidence }, null, 2));
} catch (error) {
  console.error(JSON.stringify(asSafeResult(error), null, 2));
  process.exit(1);
}

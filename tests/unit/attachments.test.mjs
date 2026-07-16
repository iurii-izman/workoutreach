import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePdfAttachment } from '../../n8n/code/lib/attachments.mjs';
import { sha256 } from '../../n8n/code/lib/normalize.mjs';

test('validates external PDF signature, filename, size and approved hash', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'workoutreach-attachment-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filename = 'approved-cv.pdf';
  const path = join(directory, filename);
  const contents = Buffer.from('%PDF-1.7\nsynthetic-test-pdf\n%%EOF\n');
  await writeFile(path, contents);
  const result = await validatePdfAttachment({ path, expectedFilename: filename, expectedSha256: sha256(contents) });
  assert.equal(result.status, 'VALIDATED');
  assert.equal(result.filename, filename);
  assert.equal(result.tracked_in_git, false);
  await assert.rejects(validatePdfAttachment({ path, expectedFilename: filename, expectedSha256: '0'.repeat(64) }), { code: 'ATTACHMENT_HASH_MISMATCH' });
});

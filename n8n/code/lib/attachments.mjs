import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { SafeStop } from './errors.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

async function hashFile(path) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

export async function validatePdfAttachment({ path, expectedSha256, expectedFilename, maxBytes = 5 * 1024 * 1024 }) {
  if (!path || !isAbsolute(path)) throw new SafeStop('ATTACHMENT_PATH_INVALID', 'CV attachment path must be absolute');
  if (!SHA256_PATTERN.test(String(expectedSha256 ?? '').toLowerCase())) {
    throw new SafeStop('ATTACHMENT_HASH_INVALID', 'CV attachment requires an expected SHA-256 value');
  }
  if (!expectedFilename || basename(path).normalize('NFKC') !== expectedFilename.normalize('NFKC')) {
    throw new SafeStop('ATTACHMENT_FILENAME_MISMATCH', 'CV attachment filename does not match the approved manifest');
  }

  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new SafeStop('ATTACHMENT_UNAVAILABLE', 'CV attachment is not available at the configured path');
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new SafeStop('ATTACHMENT_TYPE_BLOCKED', 'CV attachment must be a regular non-symlink file');
  if (info.size < 5 || info.size > maxBytes) throw new SafeStop('ATTACHMENT_SIZE_BLOCKED', 'CV attachment is outside the allowed size range', { bytes: info.size, maxBytes });

  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(5);
    await handle.read(signature, 0, signature.length, 0);
    if (signature.toString('ascii') !== '%PDF-') throw new SafeStop('ATTACHMENT_FORMAT_BLOCKED', 'CV attachment is not a PDF file');
  } finally {
    await handle.close();
  }

  const actualSha256 = await hashFile(path);
  if (actualSha256 !== expectedSha256.toLowerCase()) throw new SafeStop('ATTACHMENT_HASH_MISMATCH', 'CV attachment content changed after owner approval');
  return {
    status: 'VALIDATED',
    filename: expectedFilename,
    mime_type: 'application/pdf',
    bytes: info.size,
    sha256: actualSha256,
    source: 'external_read_only_runtime_asset',
    tracked_in_git: false,
  };
}

export async function validateConfiguredCv(env = process.env) {
  return validatePdfAttachment({
    path: env.CV_ATTACHMENT_PATH,
    expectedSha256: env.CV_ATTACHMENT_SHA256,
    expectedFilename: env.CV_ATTACHMENT_FILENAME ?? 'Iurii_Izman_CV_Bitrix24_AI.pdf',
  });
}

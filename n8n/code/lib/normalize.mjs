import { createHash } from 'node:crypto';

export function normalizeWhitespace(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function normalizeComparable(value) {
  return normalizeWhitespace(value).toLocaleLowerCase('ru-RU');
}

export function wordCount(value) {
  return normalizeWhitespace(value).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu)?.length ?? 0;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

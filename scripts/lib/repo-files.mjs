import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'artifacts', '.secrets']);

export function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !resolve(rel).startsWith(sep));
}

export async function listRepoEntries(root) {
  const entries = [];
  async function walk(directory) {
    for (const name of await readdir(directory)) {
      if (EXCLUDED_DIRS.has(name)) continue;
      const path = join(directory, name);
      const stat = await lstat(path);
      const resolved = await realpath(path);
      entries.push({ path, relative: relative(root, path).replaceAll('\\', '/'), stat, resolved });
      if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(path);
    }
  }
  await walk(root);
  return entries;
}

export function isProbablyText(buffer) {
  return !buffer.subarray(0, 8192).includes(0);
}

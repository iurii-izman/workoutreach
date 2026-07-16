import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SafeStop } from './errors.mjs';

export async function createFixtureFetcher(root, fixtureName) {
  const base = join(root, 'fixtures/sites', fixtureName);
  const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
  const routes = new Map(Object.entries(manifest.routes));
  return async (url) => {
    const parsed = new URL(url);
    const route = routes.get(parsed.pathname);
    if (!route) throw new SafeStop('FETCH_HTTP_STATUS', 'Synthetic fixture route was not found', { status: 404 });
    const body = await readFile(join(base, route), 'utf8');
    return { url: `${manifest.origin}${parsed.pathname}`, contentType: route.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', body, bytes: Buffer.byteLength(body) };
  };
}

export async function createModelStub(root, fixtureName) {
  const base = join(root, 'fixtures/model-results', fixtureName);
  const [fact, phrase] = await Promise.all([
    readFile(join(base, 'fact.json'), 'utf8').then(JSON.parse),
    readFile(join(base, 'phrase.json'), 'utf8').then(JSON.parse),
  ]);
  return {
    async fact(request) {
      if (request.store !== false || request.tools.length !== 0) throw new SafeStop('MODEL_REQUEST_UNSAFE', 'Fact request contract is unsafe');
      return { status: 'completed', refusal: null, output: structuredClone(fact) };
    },
    async phrase(request) {
      if (request.store !== false || request.tools.length !== 0) throw new SafeStop('MODEL_REQUEST_UNSAFE', 'Phrase request contract is unsafe');
      const payload = JSON.parse(request.input[0].content);
      if ('sources' in payload || 'pages' in payload) throw new SafeStop('MODEL_B_SCOPE_VIOLATION', 'Phrase request received full-site data');
      return { status: 'completed', refusal: null, output: structuredClone(phrase) };
    },
  };
}

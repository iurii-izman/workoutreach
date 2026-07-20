import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite, parseRobots } from '../../n8n/code/lib/crawl.mjs';
import { SafeStop } from '../../n8n/code/lib/errors.mjs';

test('robots policy blocks disallowed prefixes', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /private\n');
  assert.equal(robots.allows('https://example.com/public'), true);
  assert.equal(robots.allows('https://example.com/private/report'), false);
});

test('crawler fetches no more than six HTML pages and never fetches disallowed links', async () => {
  const fetched = [];
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    fetched.push(path);
    if (path === '/robots.txt') return { url, body: 'User-agent: *\nDisallow: /private\n' };
    if (path === '/') {
      const links = Array.from({ length: 10 }, (_value, index) => `<a href="/page-${index}">p</a>`).join('') + '<a href="/private/secret">private</a>';
      return { url, body: `<body>home ${links}</body>` };
    }
    return { url, body: `<body>content for ${path}</body>` };
  };
  const result = await crawlSite('https://example.com/', fetcher, { maxPages: 6 });
  assert.equal(result.pages.length, 6);
  assert.equal(fetched.includes('/private/secret'), false);
  assert.equal(fetched.length, 7, 'robots request plus six HTML pages');
});

test('crawler stops when robots cannot be evaluated safely', async () => {
  await assert.rejects(crawlSite('https://example.com/', async () => { throw new SafeStop('FETCH_TIMEOUT', 'timeout'); }), { code: 'ROBOTS_UNAVAILABLE' });
});

test('crawler skips optional pages that became 404 or 410 and records evidence', async () => {
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/robots.txt') return { url, body: 'User-agent: *\n' };
    if (path === '/') return { url, body: '<body>home<a href="/missing">missing</a><a href="/about">about</a></body>' };
    if (path === '/missing') throw new SafeStop('FETCH_HTTP_STATUS', 'not found', { status: 404 });
    return { url, body: '<body>usable about page</body>' };
  };
  const result = await crawlSite('https://example.com/', fetcher, { maxPages: 6 });
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.skippedPages, [{ url: 'https://example.com/missing', code: 'FETCH_HTTP_STATUS', status: 404 }]);
});

test('crawler still fails when the submitted root page is missing', async () => {
  const fetcher = async (url) => {
    if (new URL(url).pathname === '/robots.txt') return { url, body: 'User-agent: *\n' };
    throw new SafeStop('FETCH_HTTP_STATUS', 'not found', { status: 404 });
  };
  await assert.rejects(crawlSite('https://example.com/', fetcher), { code: 'FETCH_HTTP_STATUS' });
});

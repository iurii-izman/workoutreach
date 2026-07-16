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

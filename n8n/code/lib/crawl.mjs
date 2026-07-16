import * as cheerio from 'cheerio';
import { SafeStop } from './errors.mjs';
import { normalizeWhitespace, sha256 } from './normalize.mjs';
import { assertSameSite, normalizeUrl } from './url-policy.mjs';

const PRIORITIES = [
  /(^|\/)(about|company|o-nas|kompaniya)(\/|$)/iu,
  /(^|\/)(products?|services?|uslugi)(\/|$)/iu,
  /(^|\/)(cases?|projects?|reviews?|kejsy|proekty)(\/|$)/iu,
  /(^|\/)(news|blog|novosti)(\/|$)/iu,
  /(^|\/)(contacts?|kontakty)(\/|$)/iu,
];

export function htmlToPage(html, url, maxChars = 120_000) {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg,canvas,form').remove();
  const title = normalizeWhitespace($('title').first().text() || $('h1').first().text());
  const text = normalizeWhitespace($('body').text()).slice(0, maxChars);
  const links = [];
  $('a[href]').each((_index, element) => links.push($(element).attr('href')));
  return { title, text, links, contentHash: sha256(text), url };
}

function linkScore(url) {
  const index = PRIORITIES.findIndex((pattern) => pattern.test(url.pathname));
  return index === -1 ? 100 : index;
}

export function selectInternalLinks(rawLinks, root, seen = new Set()) {
  const selected = new Map();
  for (const raw of rawLinks) {
    if (!raw || /^(mailto|tel|javascript|data):/iu.test(raw)) continue;
    try {
      const candidate = assertSameSite(new URL(raw, root).href, root);
      candidate.hash = '';
      if (!seen.has(candidate.href)) selected.set(candidate.href, candidate);
    } catch {
      // Unsafe and cross-site links are ignored; they are never fetched.
    }
  }
  return [...selected.values()].sort((a, b) => linkScore(a) - linkScore(b) || a.pathname.localeCompare(b.pathname));
}

export function classifySource(url) {
  const path = new URL(url).pathname;
  const labels = ['about', 'product_or_service', 'case_study', 'news_or_blog', 'contact'];
  const index = PRIORITIES.findIndex((pattern) => pattern.test(path));
  return index === -1 ? 'homepage_or_other' : labels[index];
}

export function parseRobots(text, userAgent = 'WorkoutreachBot') {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      current = { agents: [value.toLowerCase()], disallow: [] };
      groups.push(current);
    } else if (field === 'disallow' && current && value) {
      current.disallow.push(value);
    }
  }
  const name = userAgent.toLowerCase();
  const applicable = groups.filter((group) => group.agents.some((agent) => agent === '*' || name.includes(agent)));
  return {
    allows(url) {
      const path = new URL(url).pathname;
      return !applicable.some((group) => group.disallow.some((prefix) => path.startsWith(prefix)));
    },
  };
}

async function loadRobots(root, fetcher) {
  const robotsUrl = new URL('/robots.txt', root).href;
  try {
    const response = await fetcher(robotsUrl);
    return parseRobots(response.body);
  } catch (error) {
    if (error instanceof SafeStop && error.code === 'FETCH_HTTP_STATUS' && error.details.status === 404) return parseRobots('');
    throw new SafeStop('ROBOTS_UNAVAILABLE', 'robots.txt could not be safely evaluated');
  }
}

export async function crawlSite(input, fetcher, limits = {}) {
  const options = { maxPages: 6, maxTextChars: 120_000, jobTimeoutMs: 60_000, ...limits };
  const root = normalizeUrl(input);
  const robots = await loadRobots(root, fetcher);
  if (!robots.allows(root)) throw new SafeStop('ROBOTS_BLOCKED', 'robots.txt disallows the submitted URL');
  const started = Date.now();
  const queue = [root];
  const seen = new Set();
  const pages = [];
  let totalChars = 0;

  while (queue.length && pages.length < options.maxPages) {
    if (Date.now() - started > options.jobTimeoutMs) throw new SafeStop('CRAWL_TIMEOUT', 'Job crawl budget exceeded');
    const current = queue.shift();
    if (seen.has(current.href)) continue;
    if (!robots.allows(current)) continue;
    seen.add(current.href);
    const response = await fetcher(current.href);
    if (Date.now() - started > options.jobTimeoutMs) throw new SafeStop('CRAWL_TIMEOUT', 'Job crawl budget exceeded');
    const parsed = htmlToPage(response.body, response.url, options.maxTextChars - totalChars);
    if (!parsed.text) continue;
    totalChars += parsed.text.length;
    pages.push({
      source_id: `p${String(pages.length + 1).padStart(2, '0')}`,
      source_url: response.url,
      source_type: classifySource(response.url),
      title: parsed.title,
      text: parsed.text,
      content_sha256: parsed.contentHash,
      _html: response.body,
    });
    if (totalChars >= options.maxTextChars) break;
    for (const link of selectInternalLinks(parsed.links, root, seen)) {
      if (robots.allows(link) && !queue.some((queued) => queued.href === link.href)) queue.push(link);
    }
  }
  if (pages.length === 0) throw new SafeStop('CRAWL_EMPTY', 'No usable HTML text was loaded');
  return { root: root.href, pages, totalChars, elapsedMs: Date.now() - started };
}

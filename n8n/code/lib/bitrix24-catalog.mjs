import * as cheerio from 'cheerio';
import { SafeStop } from './errors.mjs';
import { normalizeWhitespace } from './normalize.mjs';

const CATALOG_HOST = 'www.bitrix24.kz';
const PARTNER_PATH = /^\/partners\/partner\/(\d+)\/$/u;
const EXCLUDED_WEBSITE_HOSTS = [
  'bitrix24.kz', 'bitrix24.com', 'bitrix24.ru', 'bitrix24.by',
  '1c-bitrix.kz', '1c-bitrix.ru', 'facebook.com', 'instagram.com',
  'youtube.com', 't.me', 'onelink.me',
];

function canonicalPartnerUrl(raw, baseUrl) {
  const url = new URL(raw, baseUrl);
  if (url.protocol !== 'https:' || url.hostname !== CATALOG_HOST || !PARTNER_PATH.test(url.pathname)) return null;
  url.search = '';
  url.hash = '';
  return url;
}

export function extractCatalogPartners(html, sourceUrl = 'https://www.bitrix24.kz/partners/') {
  const $ = cheerio.load(html);
  const partners = new Map();
  $('a[href]').each((_index, element) => {
    const url = canonicalPartnerUrl($(element).attr('href'), sourceUrl);
    if (!url) return;
    const id = url.pathname.match(PARTNER_PATH)[1];
    const name = normalizeWhitespace($(element).text());
    if (name && !partners.has(id)) partners.set(id, { partner_id: id, company_name: name, profile_url: url.href });
  });
  return [...partners.values()];
}

function isExcludedHost(hostname) {
  return EXCLUDED_WEBSITE_HOSTS.some((excluded) => hostname === excluded || hostname.endsWith(`.${excluded}`));
}

function normalizedDisplayedHost(text) {
  return normalizeWhitespace(text).toLowerCase().replace(/^https?:\/\//u, '').replace(/^www\./u, '').replace(/[/?#].*$/u, '');
}

export function extractPublishedPartnerWebsite(html, profileUrl) {
  const $ = cheerio.load(html);
  const candidates = [];
  $('a[href]').each((_index, element) => {
    const raw = $(element).attr('href');
    let url;
    try { url = new URL(raw, profileUrl); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || isExcludedHost(url.hostname.toLowerCase())) return;
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    if (normalizedDisplayedHost($(element).text()) !== host) return;
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    url.port = '';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    candidates.push(url.href);
  });
  return [...new Set(candidates)].length === 1 ? [...new Set(candidates)][0] : null;
}

export function validateCatalogBatch(partners, maxPartners = 25) {
  if (!Array.isArray(partners) || partners.length === 0) throw new SafeStop('CATALOG_EMPTY', 'Vendor catalog contained no partner profiles');
  if (partners.length > maxPartners) throw new SafeStop('CATALOG_REVIEW_LIMIT', 'Vendor catalog exceeds the staging review limit', { count: partners.length, maxPartners });
  return partners;
}

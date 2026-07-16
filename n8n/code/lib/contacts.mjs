import * as cheerio from 'cheerio';
import { normalizeWhitespace } from './normalize.mjs';

const EMAIL_PATTERN = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)+/giu;
const PHONE_PATTERN = /(?<![\p{L}\p{N}])(?:\+?\d[\d\s().-]{5,}\d)(?![\p{L}\p{N}])/gu;

const CONTACT_POLICIES = Object.freeze({
  career_outreach: Object.freeze({ recruiting: 0, general: 1 }),
  general_outreach: Object.freeze({ general: 0, sales: 0, personal_named: 0 }),
});

export function classifyEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  if (/^(jobs?|career|careers|hr|rabota|vacancy|vacancies|recruit|recruiting|recruitment|talent|people|cv|resume)$/u.test(local)) return 'recruiting';
  if (/^(support|help|service|tech)$/u.test(local)) return 'support';
  if (/^(privacy|legal|dpo|abuse|security)$/u.test(local)) return 'privacy_or_legal';
  if (/^(sales|commercial|bizdev|partners?)$/u.test(local)) return 'sales';
  if (/^(info|contact|hello|office|mail)$/u.test(local)) return 'general';
  if (/^[\p{L}]+[._-][\p{L}]+$/u.test(local)) return 'personal_named';
  return 'unknown';
}

function validEmail(email) {
  return email.length <= 254 && !email.includes('..') && !email.startsWith('.') && !email.endsWith('.');
}

export function extractContactsFromHtml(html, page) {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg,canvas,form').remove();
  const visible = normalizeWhitespace($('body').text());
  const values = [];
  $('a[href^="mailto:"]').each((_index, element) => {
    const raw = $(element).attr('href').slice(7).split('?')[0];
    try {
      values.push(decodeURIComponent(raw));
    } catch {
      // Invalid encoded values are not contacts.
    }
  });
  values.push(...(visible.match(EMAIL_PATTERN) ?? []));

  const unique = new Map();
  for (const candidate of values) {
    const email = candidate.normalize('NFKC').trim().toLowerCase();
    if (!validEmail(email)) continue;
    const index = visible.toLowerCase().indexOf(email);
    const excerpt = index >= 0 ? visible.slice(Math.max(0, index - 60), index + email.length + 60) : `mailto:${email}`;
    const category = classifyEmail(email);
    unique.set(email, {
      email,
      normalized_email: email,
      category,
      source_id: page.source_id,
      source_url: page.source_url,
      source_excerpt: normalizeWhitespace(excerpt),
      automatic_selection_allowed: false,
    });
  }
  return [...unique.values()];
}

export function deduplicateContacts(candidates) {
  const unique = new Map();
  for (const candidate of candidates) if (!unique.has(candidate.normalized_email)) unique.set(candidate.normalized_email, candidate);
  return [...unique.values()];
}

export function chooseContact(candidates, { campaignType = 'general_outreach' } = {}) {
  const priorities = CONTACT_POLICIES[campaignType];
  if (!priorities) throw new TypeError(`Unknown contact campaign policy: ${campaignType}`);
  const evaluated = candidates.map((candidate) => ({
    ...candidate,
    automatic_selection_allowed: Object.hasOwn(priorities, candidate.category),
  }));
  const allowed = evaluated.filter((candidate) => candidate.automatic_selection_allowed);
  if (allowed.length === 0) return { decision: 'NEEDS_CONTACT', selected: null, candidates: evaluated, campaign_type: campaignType };
  const bestPriority = Math.min(...allowed.map((candidate) => priorities[candidate.category]));
  const best = allowed.filter((candidate) => priorities[candidate.category] === bestPriority);
  if (best.length !== 1) {
    return { decision: 'NEEDS_REVIEW', selected: null, candidates: evaluated, campaign_type: campaignType };
  }
  return { decision: 'SELECTED_FOR_REVIEW', selected: best[0], candidates: evaluated, campaign_type: campaignType };
}

function normalizePhone(candidate) {
  const raw = normalizeWhitespace(candidate);
  const digits = raw.replace(/\D/gu, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return { phone: raw, normalized_phone: `${raw.trim().startsWith('+') ? '+' : ''}${digits}` };
}

export function extractPhonesFromHtml(html, page) {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg,canvas,form').remove();
  const visible = normalizeWhitespace($('body').text());
  const values = [];
  $('a[href^="tel:"]').each((_index, element) => {
    const raw = $(element).attr('href').slice(4).split(/[?;]/u)[0];
    try {
      values.push(decodeURIComponent(raw));
    } catch {
      // Invalid encoded values are not contacts.
    }
  });
  values.push(...(visible.match(PHONE_PATTERN) ?? []));

  const unique = new Map();
  for (const value of values) {
    const normalized = normalizePhone(value);
    if (!normalized || unique.has(normalized.normalized_phone)) continue;
    const rendered = normalizeWhitespace(value);
    const visibleIndex = visible.indexOf(rendered);
    const excerpt = visibleIndex >= 0
      ? visible.slice(Math.max(0, visibleIndex - 60), visibleIndex + rendered.length + 60)
      : `tel:${normalized.phone}`;
    unique.set(normalized.normalized_phone, {
      ...normalized,
      source_id: page.source_id,
      source_url: page.source_url,
      source_type: page.source_type,
      source_excerpt: normalizeWhitespace(excerpt).slice(0, 240),
    });
  }
  return [...unique.values()];
}

export function deduplicatePhones(candidates) {
  const unique = new Map();
  for (const candidate of candidates) if (!unique.has(candidate.normalized_phone)) unique.set(candidate.normalized_phone, candidate);
  return [...unique.values()];
}

export function choosePhone(candidates) {
  if (candidates.length === 0) return { decision: 'NOT_FOUND', selected: null, candidates };
  const bestPriority = Math.min(...candidates.map((candidate) => candidate.source_type === 'contact' ? 0 : 1));
  const best = candidates.filter((candidate) => (candidate.source_type === 'contact' ? 0 : 1) === bestPriority);
  if (best.length !== 1) return { decision: 'NEEDS_REVIEW', selected: null, candidates };
  return { decision: 'SELECTED_FOR_REVIEW', selected: best[0], candidates };
}

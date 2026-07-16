import * as cheerio from 'cheerio';
import { normalizeWhitespace } from './normalize.mjs';

const EMAIL_PATTERN = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)+/giu;

export function classifyEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  if (/^(jobs?|career|careers|hr|rabota|vacancy|vacancies)$/u.test(local)) return 'recruiting';
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
    values.push(decodeURIComponent(raw));
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
      automatic_selection_allowed: ['general', 'sales', 'personal_named'].includes(category),
    });
  }
  return [...unique.values()];
}

export function deduplicateContacts(candidates) {
  const unique = new Map();
  for (const candidate of candidates) if (!unique.has(candidate.normalized_email)) unique.set(candidate.normalized_email, candidate);
  return [...unique.values()];
}

export function chooseContact(candidates) {
  const allowed = candidates.filter((candidate) => candidate.automatic_selection_allowed);
  if (allowed.length === 0) return { decision: 'NEEDS_CONTACT', selected: null, candidates };
  if (allowed.length > 1 || allowed.some((candidate) => candidate.category === 'unknown')) {
    return { decision: 'NEEDS_REVIEW', selected: null, candidates };
  }
  return { decision: 'SELECTED_FOR_REVIEW', selected: allowed[0], candidates };
}

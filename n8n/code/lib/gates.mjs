import { SafeStop } from './errors.mjs';
import { normalizeComparable, normalizeWhitespace, wordCount } from './normalize.mjs';

export function evidenceGate(fact, pages, hostname) {
  const source = pages.find((page) => page.source_id === fact.source_id);
  if (!source) throw new SafeStop('EVIDENCE_SOURCE_UNKNOWN', 'Model selected a source that was not loaded');
  if (source.source_type !== fact.source_type) throw new SafeStop('EVIDENCE_SOURCE_TYPE_MISMATCH', 'Model source type does not match loaded metadata');

  const sourceText = normalizeComparable(source.text);
  const excerpt = normalizeComparable(fact.source_excerpt);
  const normalizedFact = normalizeComparable(fact.fact);
  if (!sourceText.includes(excerpt)) throw new SafeStop('EVIDENCE_EXCERPT_NOT_FOUND', 'Evidence excerpt is not a literal substring of the loaded source');
  if (!excerpt.includes(normalizedFact)) throw new SafeStop('EVIDENCE_FACT_NOT_LITERAL', 'Fact is not literally grounded in the evidence excerpt');

  const company = normalizeComparable(fact.company_name);
  const companyOnSite = pages.some((page) => normalizeComparable(page.text).includes(company));
  const companyInDomain = hostname.toLowerCase().includes(company.replace(/[^\p{L}\p{N}]+/gu, ''));
  if (!companyOnSite && !companyInDomain) throw new SafeStop('EVIDENCE_COMPANY_UNCONFIRMED', 'Company name is not confirmed by the loaded site or domain');
  if (fact.published_at !== null && !excerpt.includes(normalizeComparable(fact.published_at))) {
    throw new SafeStop('EVIDENCE_DATE_UNCONFIRMED', 'Publication date is not present in the evidence excerpt');
  }
  if (fact.decision !== 'READY_FOR_REVIEW') throw new SafeStop('EVIDENCE_MODEL_STOP', 'Fact model did not approve review');
  return { accepted: true, source, checks: ['source_id', 'source_type', 'excerpt_literal', 'fact_literal', 'company', 'published_at'] };
}

export function businessGate(phrase, offerProfile) {
  if (!offerProfile.owner_approved && !offerProfile.synthetic_eval) throw new SafeStop('OFFER_NOT_APPROVED', 'Offer profile is not owner-approved');
  const allowedIds = new Set(offerProfile.claims.map((claim) => claim.id));
  if (phrase.offer_claim_ids.some((id) => !allowedIds.has(id))) throw new SafeStop('OFFER_CLAIM_UNKNOWN', 'Phrase references a claim outside the offer profile');
  if (phrase.decision !== 'READY_FOR_REVIEW') throw new SafeStop('PHRASE_MODEL_STOP', 'Phrase model did not approve review');

  const text = normalizeWhitespace(phrase.personalization_phrase);
  const count = wordCount(text);
  if (count < 18 || count > 35) throw new SafeStop('PHRASE_WORD_COUNT', 'Personalization phrase is outside the 18–35 word range', { wordCount: count });
  if ((text.match(/[А-Яа-яЁё]/gu)?.length ?? 0) < 5) throw new SafeStop('PHRASE_LANGUAGE', 'Personalization phrase is not demonstrably Russian');
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(text)) throw new SafeStop('PHRASE_EMAIL_BLOCKED', 'Personalization phrase contains an email address');
  if (/<[^>]+>|\[[^\]]+\]\([^)]+\)|https?:\/\//iu.test(text)) throw new SafeStop('PHRASE_MARKUP_BLOCKED', 'Personalization phrase contains markup or a link');
  if (/\b(?:ignore|system prompt|инструкц(?:ия|ии)|выполни|```|<script)\b/iu.test(text)) throw new SafeStop('PHRASE_INSTRUCTION_BLOCKED', 'Personalization phrase contains instruction-like content');
  if (/\+?\d[\d\s().-]{7,}\d/u.test(text)) throw new SafeStop('PHRASE_PHONE_BLOCKED', 'Personalization phrase contains a phone number');
  return { accepted: true, wordCount: count, checks: ['offer_claim_ids', 'decision', 'word_count', 'language', 'pii', 'markup', 'instructions'] };
}

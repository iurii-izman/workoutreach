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
  const companyOnSite = pages.some((page) => normalizeComparable(`${page.title ?? ''} ${page.text}`).includes(company));
  const domainBrand = String(hostname).toLowerCase().split('.').filter((label) => label !== 'www').join('');
  const companyInDomain = company
    .match(/[\p{L}\p{M}\p{N}]+/gu)
    ?.some((token) => token.length >= 4 && /^[a-z0-9]+$/u.test(token) && domainBrand.includes(token)) ?? false;
  if (!companyOnSite && !companyInDomain) throw new SafeStop('EVIDENCE_COMPANY_UNCONFIRMED', 'Company name is not confirmed by the loaded site or domain');
  const publishedAtConfirmed = fact.published_at === null || excerpt.includes(normalizeComparable(fact.published_at));
  const publishedAt = publishedAtConfirmed ? fact.published_at : null;
  const warnings = publishedAtConfirmed ? [] : ['PUBLISHED_AT_UNCONFIRMED_REMOVED'];
  if (fact.decision !== 'READY_FOR_REVIEW') throw new SafeStop('EVIDENCE_MODEL_STOP', 'Fact model did not approve review');
  return { accepted: true, source, publishedAt, warnings, checks: ['source_id', 'source_type', 'excerpt_literal', 'fact_literal', 'company', 'published_at'] };
}

export function businessGate(phrase, offerProfile, { acceptedFact = null } = {}) {
  if (!offerProfile.owner_approved && !offerProfile.synthetic_eval) throw new SafeStop('OFFER_NOT_APPROVED', 'Offer profile is not owner-approved');
  const allowedIds = new Set(offerProfile.claims.map((claim) => claim.id));
  if (phrase.offer_claim_ids.length !== 1) throw new SafeStop('OFFER_CLAIM_COUNT', 'Phrase must reference exactly one approved offer claim');
  if (phrase.offer_claim_ids.some((id) => !allowedIds.has(id))) throw new SafeStop('OFFER_CLAIM_UNKNOWN', 'Phrase references a claim outside the offer profile');
  if (phrase.decision !== 'READY_FOR_REVIEW') throw new SafeStop('PHRASE_MODEL_STOP', 'Phrase model did not approve review');

  const text = normalizeWhitespace(phrase.personalization_phrase);
  const count = wordCount(text);
  if (count < 18 || count > 35) throw new SafeStop('PHRASE_WORD_COUNT', 'Personalization phrase is outside the hard 18–35 word range', { wordCount: count });
  const sentenceMarks = text.match(/[.!?]+/gu) ?? [];
  if (sentenceMarks.length < 1 || sentenceMarks.length > 2 || !/[.!?]$/u.test(text)) throw new SafeStop('PHRASE_SENTENCE_COUNT', 'Personalization phrase must contain no more than two complete sentences');
  if ((text.match(/[А-Яа-яЁё]/gu)?.length ?? 0) < 5) throw new SafeStop('PHRASE_LANGUAGE', 'Personalization phrase is not demonstrably Russian');
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(text)) throw new SafeStop('PHRASE_EMAIL_BLOCKED', 'Personalization phrase contains an email address');
  if (/<[^>]+>|\[[^\]]+\]\([^)]+\)|https?:\/\//iu.test(text)) throw new SafeStop('PHRASE_MARKUP_BLOCKED', 'Personalization phrase contains markup or a link');
  if (/(?<![\p{L}\p{M}\p{N}_])(?:ignore|system prompt|инструкц(?:ия|ии)|выполни|```|<script)(?![\p{L}\p{M}\p{N}_])/iu.test(text)) throw new SafeStop('PHRASE_INSTRUCTION_BLOCKED', 'Personalization phrase contains instruction-like content');
  if (/\+?\d[\d\s().-]{7,}\d/u.test(text)) throw new SafeStop('PHRASE_PHONE_BLOCKED', 'Personalization phrase contains a phone number');
  if (/(?<![\p{L}\p{M}\p{N}_])(?:добрый\s+день|подскажите|буду\s+рад|созвон|резюме|с\s+уважением|telegram)(?![\p{L}\p{M}\p{N}_])/iu.test(text)) {
    throw new SafeStop('PHRASE_TEMPLATE_CONTENT', 'Personalization phrase contains greeting, CTA, CV reference or signature content');
  }
  const candidatePerspective = /(?<![\p{L}\p{M}\p{N}_])(?:я|мне|мной|мой|моя|моё|мои|моего|моей|моему|моим|моими|моих|могу|помогаю|работаю|занимаюсь)(?![\p{L}\p{M}\p{N}_])/giu;
  const perspectiveMarkers = text.match(candidatePerspective) ?? [];
  if (perspectiveMarkers.length !== 1) {
    throw new SafeStop('PHRASE_PERSPECTIVE', 'Personalization phrase must contain exactly one first-person marker for the candidate connection');
  }
  const recipientOwnsCandidateClaim = /(?<![\p{L}\p{M}\p{N}_])ваш(?:а|е|и|его|ей|ему|ем|у|ой|им|ими|их)?\s+(?:(?:полный|профессиональный|практический)\s+)?(?:аналитический\s+цикл|опыт|профиль|компетенц[\p{L}\p{M}]*|навык[\p{L}\p{M}]*)(?![\p{L}\p{M}\p{N}_])/iu;
  if (recipientOwnsCandidateClaim.test(text)) {
    throw new SafeStop('PHRASE_PERSPECTIVE', 'Personalization phrase attributes a candidate-owned claim to the recipient');
  }
  if (/(?<![\p{L}\p{M}\p{N}_])релевантн[\p{L}\p{M}]*(?![\p{L}\p{M}\p{N}_])/iu.test(text)) {
    throw new SafeStop('PHRASE_VAGUE_CONNECTION', 'Personalization phrase uses an abstract relevance conclusion instead of a concrete human connection');
  }
  if (/[;:]/u.test(text)) {
    throw new SafeStop('PHRASE_STYLE', 'Personalization phrase compresses separate thoughts with a semicolon or colon');
  }
  if (sentenceMarks.length !== 2 || !/[.!?]\s+Мне\s+близки\s+такие\s+(?:комплексные\s+)?(?:проекты|задачи),\s+где(?![\p{L}\p{M}\p{N}_])/u.test(text)) {
    throw new SafeStop('PHRASE_BRIDGE_FORM', 'Personalization phrase must use the reviewed two-sentence company-fact and human-bridge form');
  }
  const firstSentence = text.split(/[.!?]/u, 1)[0];
  if (/^Ваш\s+кейс(?![\p{L}\p{M}\p{N}_])/iu.test(firstSentence)
      && !/(?<![\p{L}\p{M}\p{N}_])(?:показывает|описывает|демонстрирует|охватывает|объединяет|связывает|отражает|подтверждает)(?![\p{L}\p{M}\p{N}_])/iu.test(firstSentence)) {
    throw new SafeStop('PHRASE_SENTENCE_FRAGMENT', 'The company-fact sentence is a heading-like noun phrase without a finite predicate');
  }
  const factText = normalizeWhitespace(acceptedFact);
  if (/(?<![\p{L}\p{M}\p{N}_])кейс(?![\p{L}\p{M}\p{N}_])/iu.test(factText)
      && /(?<![\p{L}\p{M}\p{N}_])у\s+вас(?![\p{L}\p{M}\p{N}_])[^.!?]{0,100}(?<![\p{L}\p{M}\p{N}_])внедр[\p{L}\p{M}]*/iu.test(text)) {
    throw new SafeStop('PHRASE_FACT_PERSPECTIVE', 'A published customer case was rewritten as the recipient company internal implementation');
  }
  if (/(?<![\p{L}\p{M}\p{N}_])(?:(?:более\s+чем\s+)?(?:6|шест[\p{L}\p{M}]*)\s+(?:лет|год[\p{L}\p{M}]*)|25\s*\+)(?![\p{L}\p{M}\p{N}_])/iu.test(text)) {
    throw new SafeStop('PHRASE_TEMPLATE_REPETITION', 'Personalization phrase repeats candidate metrics already stated in the fixed email');
  }
  if (/(?:обследован[\p{L}\p{M}]*\s+процесс[\p{L}\p{M}]*|проектирован[\p{L}\p{M}]*[^.!?]{0,30}интеграц[\p{L}\p{M}]*|формирован[\p{L}\p{M}]*\s+требован[\p{L}\p{M}]*|постановк[\p{L}\p{M}]*\s+задач[\p{L}\p{M}]*|став[\p{L}\p{M}]*\s+задач[\p{L}\p{M}]*\s+разработ|сопровожд[\p{L}\p{M}]*[^.!?]{0,40}\s+запуск[\p{L}\p{M}]*|python|fastapi|rest\s+api|вебхук[\p{L}\p{M}]*|ai-прототип[\p{L}\p{M}]*)/iu.test(text)) {
    throw new SafeStop('PHRASE_TEMPLATE_REPETITION', 'Personalization phrase repeats detailed capabilities already stated in the fixed email');
  }
  if (/^Ваш[ае]\s+[\p{L}\p{M}-]+(?:\s+[\p{L}\p{M}-]+){0,3}\s+и\s+[\p{L}\p{M}-]+[^.!?]{0,160}(?<![\p{L}\p{M}])пересекается(?![\p{L}\p{M}])/iu.test(text)) {
    throw new SafeStop('PHRASE_GRAMMAR_AGREEMENT', 'Compound Russian subject requires plural verb agreement');
  }
  const targetRange = count >= 25 && count <= 32;
  return { accepted: true, wordCount: count, targetRange, checks: ['offer_claim_ids', 'decision', 'word_count', 'two_sentence_bridge', 'complete_company_sentence', 'language', 'pii', 'markup', 'instructions', 'template_separation', 'single_candidate_perspective', 'fact_actor_perspective', 'concrete_connection', 'no_resume_metric_repetition', 'light_bridge_style', 'grammar_agreement'] };
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crawlSite } from './crawl.mjs';
import { chooseContact, choosePhone, deduplicateContacts, deduplicatePhones, extractContactsFromHtml, extractPhonesFromHtml } from './contacts.mjs';
import { SafeStop } from './errors.mjs';
import { businessGate, evidenceGate } from './gates.mjs';
import {
  assertCompletedModelEnvelope,
  assertSchema,
  buildFactRequest,
  buildPhraseRequest,
  loadModelContracts,
} from './model-contract.mjs';
import { normalizeWhitespace, sha256, stableJson, wordCount } from './normalize.mjs';
import { loadTemplate, renderDraft } from './templates.mjs';
import { renderTelegramPreview } from './telegram.mjs';

export function makeJobId(seed) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const digest = Buffer.from(sha256(String(seed)), 'hex');
  let suffix = '';
  for (let index = 0; index < 6; index += 1) suffix += alphabet[digest[index] % alphabet.length];
  return `WO-${suffix}`;
}

export function compactEvidenceExcerpt(sourceText, factText, maxChars = 500) {
  const source = normalizeWhitespace(sourceText);
  const fact = normalizeWhitespace(factText);
  const index = source.toLocaleLowerCase('ru-RU').indexOf(fact.toLocaleLowerCase('ru-RU'));
  if (index === -1) throw new SafeStop('EVIDENCE_FACT_NOT_LITERAL', 'Accepted fact could not be located for compact evidence');
  if (source.length <= maxChars) return source;
  const padding = Math.max(0, maxChars - fact.length);
  let start = Math.max(0, Math.min(index - Math.floor(padding / 2), source.length - maxChars));
  let end = Math.min(source.length, start + maxChars);
  const sentenceBoundaries = ['. ', '! ', '? '].map((mark) => source.indexOf(mark, start)).filter((position) => position >= start && position < index);
  const sentenceAdjusted = sentenceBoundaries.length > 0;
  if (sentenceAdjusted) start = Math.min(...sentenceBoundaries) + 2;
  if (!sentenceAdjusted && start > 0) {
    const nextBoundary = source.indexOf(' ', start);
    if (nextBoundary !== -1 && nextBoundary < index) start = nextBoundary + 1;
  }
  if (end < source.length) {
    const previousBoundary = source.lastIndexOf(' ', end);
    if (previousBoundary > index + fact.length) end = previousBoundary;
  }
  return source.slice(start, end).trim();
}

export async function loadOfferProfile(root, relative = 'product/offer-profile.v1.yaml') {
  return JSON.parse(await readFile(join(root, relative), 'utf8'));
}

export async function analyzeDryRun({ root, inputUrl, fetcher, modelAdapter, offerProfile, attachment = null, modelSettings = {}, factModelSettings = modelSettings, phraseModelSettings = modelSettings, crawlLimits = {}, onModelEnvelope = null, beforeModelCalls = null, seed = inputUrl, jobId = makeJobId(seed), mode = 'offline-stub' }) {
  if (!offerProfile || (!offerProfile.owner_approved && !offerProfile.synthetic_eval)) {
    throw new SafeStop('OFFER_NOT_APPROVED', 'An owner-approved or synthetic-eval offer profile is required');
  }
  if (!/^WO-[A-Z0-9]{6}$/u.test(jobId)) throw new SafeStop('JOB_ID_INVALID', 'Job identifier is outside the canonical contract');
  const crawl = await crawlSite(inputUrl, fetcher, crawlLimits);
  const contacts = deduplicateContacts(crawl.pages.flatMap((page) => extractContactsFromHtml(page._html, page)));
  const contactDecision = chooseContact(contacts, { campaignType: offerProfile.campaign_type ?? 'general_outreach' });
  if (contactDecision.decision === 'NEEDS_CONTACT') throw new SafeStop('NEEDS_CONTACT', 'No eligible published contact address was found');
  if (contactDecision.decision === 'NEEDS_REVIEW') throw new SafeStop('NEEDS_REVIEW', 'Multiple or ambiguous contact addresses require operator selection');
  const phoneCandidates = deduplicatePhones(crawl.pages.flatMap((page) => extractPhonesFromHtml(page._html, page)));
  const phoneDecision = choosePhone(phoneCandidates);

  const pages = crawl.pages.map(({ _html, ...page }) => page);
  const hostname = new URL(crawl.root).hostname;
  const contracts = await loadModelContracts(root);
  const factRequest = await buildFactRequest(root, pages, factModelSettings);
  if (beforeModelCalls) await beforeModelCalls();
  const factEnvelope = await modelAdapter.fact(factRequest);
  if (onModelEnvelope) await onModelEnvelope({ phase: 'fact', envelope: factEnvelope });
  const fact = assertSchema(contracts.validateFact, assertCompletedModelEnvelope(factEnvelope), 'FACT_SCHEMA_INVALID');
  const evidence = evidenceGate(fact, pages, hostname);
  const compactExcerpt = compactEvidenceExcerpt(evidence.source.text, fact.fact);

  const phraseRequest = await buildPhraseRequest(root, fact, offerProfile, phraseModelSettings);
  const phraseEnvelope = await modelAdapter.phrase(phraseRequest);
  if (onModelEnvelope) await onModelEnvelope({ phase: 'phrase', envelope: phraseEnvelope });
  const phrase = assertSchema(contracts.validatePhrase, assertCompletedModelEnvelope(phraseEnvelope), 'PHRASE_SCHEMA_INVALID');
  const business = businessGate(phrase, offerProfile);

  const aggregate = {
    company_name: fact.company_name,
    fact: fact.fact,
    source_id: fact.source_id,
    source_excerpt: compactExcerpt,
    source_type: fact.source_type,
    published_at: fact.published_at,
    personalization_phrase: phrase.personalization_phrase,
    overlap: phrase.overlap,
    offer_claim_ids: phrase.offer_claim_ids,
    word_count: wordCount(phrase.personalization_phrase),
    confidence: fact.confidence,
    decision: 'READY_FOR_REVIEW',
    warnings: [...fact.warnings, ...phrase.warnings],
  };
  if (!business.targetRange) aggregate.warnings.push('PHRASE_OUTSIDE_TARGET_25_35');
  if (crawl.skippedPages.some((page) => page.code === 'FETCH_HTTP_STATUS')) aggregate.warnings.push('OPTIONAL_PAGE_NOT_FOUND_SKIPPED');
  if (crawl.skippedPages.some((page) => page.code === 'FETCH_TIMEOUT')) aggregate.warnings.push('OPTIONAL_PAGE_TIMEOUT_SKIPPED');
  assertSchema(contracts.validateAggregate, aggregate, 'AGGREGATE_SCHEMA_INVALID');

  const template = await loadTemplate(root);
  const draft = renderDraft(template, {
    PERSONALIZATION_PHRASE: aggregate.personalization_phrase,
    COMPANY_NAME: aggregate.company_name,
  });
  if (attachment) draft.attachment = attachment;
  const source = pages.find((page) => page.source_id === aggregate.source_id);
  const warnings = [...aggregate.warnings, template.manifest.notice];
  if (mode === 'offline-stub') warnings.push('Telegram transport is stubbed; no message was transmitted');
  const preview = renderTelegramPreview({
    jobId,
    siteUrl: crawl.root,
    recipient: contactDecision.selected,
    phone: phoneDecision,
    analysis: aggregate,
    draft,
    source,
    warnings,
  });

  return {
    ok: true,
    mode,
    job_id: jobId,
    status: 'DRAFT_READY',
    crawl: { page_count: pages.length, skipped_pages: crawl.skippedPages, total_chars: crawl.totalChars, pages },
    contact: contactDecision,
    phone: phoneDecision,
    analysis: aggregate,
    draft,
    telegram_preview: preview,
    safety: { live_send_enabled: false, mail_transport: 'disabled', transmitted: false, mail_transmitted: false, telegram_preview_transmitted: false, outbox_created: false },
    evidence: {
      fact_request_sha256: sha256(stableJson(factRequest)),
      phrase_request_sha256: sha256(stableJson(phraseRequest)),
      fact_prompt_version: factRequest.metadata.prompt_version,
      fact_prompt_sha256: factRequest.metadata.prompt_sha256,
      fact_schema_sha256: factRequest.metadata.schema_sha256,
      phrase_prompt_version: phraseRequest.metadata.prompt_version,
      phrase_prompt_sha256: phraseRequest.metadata.prompt_sha256,
      phrase_schema_sha256: phraseRequest.metadata.schema_sha256,
      offer_version: offerProfile.version ?? null,
      offer_sha256: sha256(stableJson(offerProfile)),
      template_sha256: draft.template_sha256,
      source_content_sha256: source.content_sha256,
      evidence_checks: evidence.checks,
      business_checks: business.checks,
      fact_model: factEnvelope.metadata ?? null,
      phrase_model: phraseEnvelope.metadata ?? null,
    },
  };
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crawlSite } from './crawl.mjs';
import { chooseContact, choosePhone, deduplicateContacts, deduplicatePhones, extractContactsFromHtml, extractPhonesFromHtml, normalizeExplicitEmail } from './contacts.mjs';
import { asSafeResult, SafeStop } from './errors.mjs';
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

export function repairPhraseFormatting(value) {
  let text = normalizeWhitespace(value);
  const quoted = (text.startsWith('«') && text.endsWith('»')) || (text.startsWith('"') && text.endsWith('"'));
  if (quoted) text = normalizeWhitespace(text.slice(1, -1));
  if (!/[.!?]/u.test(text)) text = `${text}.`;
  return text;
}

function optionalPersonalizationFailure(code) {
  return /^(?:OPENAI_|MODEL_|FACT_SCHEMA_INVALID$|EVIDENCE_|PHRASE_)/u.test(String(code));
}

function retryablePhraseFailure(code) {
  return ['PHRASE_SENTENCE_COUNT', 'PHRASE_WORD_COUNT', 'PHRASE_GRAMMAR_AGREEMENT'].includes(code);
}

function mergeModelMetadata(envelopes) {
  const metadata = envelopes.map((envelope) => envelope?.metadata).filter(Boolean);
  if (metadata.length === 0) return null;
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const usage = metadata.reduce((total, item) => ({
    input_tokens: total.input_tokens + number(item.usage?.input_tokens),
    output_tokens: total.output_tokens + number(item.usage?.output_tokens),
    total_tokens: total.total_tokens + number(item.usage?.total_tokens),
    input_tokens_details: {
      cached_tokens: total.input_tokens_details.cached_tokens + number(item.usage?.input_tokens_details?.cached_tokens),
      cache_write_tokens: total.input_tokens_details.cache_write_tokens + number(item.usage?.input_tokens_details?.cache_write_tokens),
    },
    output_tokens_details: {
      reasoning_tokens: total.output_tokens_details.reasoning_tokens + number(item.usage?.output_tokens_details?.reasoning_tokens),
    },
  }), {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  });
  const last = metadata.at(-1);
  return {
    response_id: last.response_id ?? null,
    model: last.model ?? null,
    service_tier: last.service_tier ?? null,
    usage,
    attempt_count: metadata.length,
  };
}

function safeSourceExcerpt(source, maxChars = 500) {
  const text = normalizeWhitespace(source?.text);
  if (!text) throw new SafeStop('UNIVERSAL_EVIDENCE_MISSING', 'Universal draft requires locally loaded source evidence');
  return text.slice(0, maxChars).trim();
}

export async function loadOfferProfile(root, relative = 'product/offer-profile.v1.yaml') {
  return JSON.parse(await readFile(join(root, relative), 'utf8'));
}

export async function analyzeDryRun({ root, inputUrl, fetcher, modelAdapter, offerProfile, attachment = null, modelSettings = {}, factModelSettings = modelSettings, phraseModelSettings = modelSettings, crawlLimits = {}, onModelEnvelope = null, beforeModelCalls = null, seed = inputUrl, jobId = makeJobId(seed), mode = 'offline-stub', contactSelection = null, personalizationMode = 'optional', acceptedFact = null }) {
  if (!offerProfile || (!offerProfile.owner_approved && !offerProfile.synthetic_eval)) {
    throw new SafeStop('OFFER_NOT_APPROVED', 'An owner-approved or synthetic-eval offer profile is required');
  }
  if (!/^WO-[A-Z0-9]{6}$/u.test(jobId)) throw new SafeStop('JOB_ID_INVALID', 'Job identifier is outside the canonical contract');
  if (!['off', 'optional', 'required'].includes(personalizationMode)) throw new SafeStop('PERSONALIZATION_MODE_INVALID', 'Personalization mode must be off, optional or required');
  const crawl = await crawlSite(inputUrl, fetcher, crawlLimits);
  const contacts = deduplicateContacts(crawl.pages.flatMap((page) => extractContactsFromHtml(page._html, page)));
  const phoneCandidates = deduplicatePhones(crawl.pages.flatMap((page) => extractPhonesFromHtml(page._html, page)));
  const phoneDecision = choosePhone(phoneCandidates);
  const pages = crawl.pages.map(({ _html, ...page }) => page);
  let contactDecision = chooseContact(contacts, { campaignType: offerProfile.campaign_type ?? 'general_outreach' });

  if (contactSelection?.type === 'published') {
    const normalized = normalizeExplicitEmail(contactSelection.email);
    const selected = contactDecision.candidates.find((candidate) => candidate.normalized_email === normalized && candidate.provenance === 'published' && candidate.automatic_selection_allowed);
    if (!selected) throw new SafeStop('CONTACT_SELECTION_STALE', 'Selected published contact is no longer present on the authorized site');
    contactDecision = { ...contactDecision, decision: 'SELECTED_FOR_REVIEW', selected, selection_method: 'operator_published' };
  } else if (contactSelection?.type === 'manual') {
    const email = normalizeExplicitEmail(contactSelection.email);
    const manual = {
      email,
      normalized_email: email,
      category: 'manual',
      source_id: 'manual',
      source_url: crawl.root,
      source_excerpt: 'Known address supplied explicitly by the owner in Telegram.',
      automatic_selection_allowed: false,
      provenance: 'manual',
    };
    contactDecision = {
      decision: 'SELECTED_FOR_REVIEW',
      selected: manual,
      candidates: [...contactDecision.candidates, manual],
      campaign_type: offerProfile.campaign_type ?? 'general_outreach',
      selection_method: 'operator_manual',
    };
  } else if (contactSelection) {
    throw new SafeStop('CONTACT_SELECTION_INVALID', 'Unknown contact selection method');
  }

  if (['NEEDS_CONTACT', 'NEEDS_REVIEW'].includes(contactDecision.decision)) {
    return {
      ok: true,
      mode,
      job_id: jobId,
      status: contactDecision.decision,
      crawl: { page_count: pages.length, skipped_pages: crawl.skippedPages, total_chars: crawl.totalChars, pages },
      contact: contactDecision,
      phone: phoneDecision,
      safety: { live_send_enabled: false, mail_transport: 'disabled', transmitted: false, mail_transmitted: false, telegram_preview_transmitted: false, outbox_created: false },
    };
  }

  const hostname = new URL(crawl.root).hostname;
  const contracts = await loadModelContracts(root);
  const template = await loadTemplate(root);
  const factEnvelopes = [];
  const phraseEnvelopes = [];
  const phraseRequests = [];
  let factRequest = null;
  let phraseRequest = null;
  let fact = null;
  let evidence = null;
  let business = null;
  let phrase = null;
  let personalizationFailureCode = null;
  let modelReserved = false;
  const reserveModelBudget = async () => {
    if (modelReserved) return;
    if (beforeModelCalls) await beforeModelCalls();
    modelReserved = true;
  };

  if (personalizationMode !== 'off') {
    try {
      factRequest = await buildFactRequest(root, pages, factModelSettings);
      if (acceptedFact) {
        fact = assertSchema(contracts.validateFact, structuredClone(acceptedFact), 'FACT_SCHEMA_INVALID');
      } else {
        await reserveModelBudget();
        const envelope = await modelAdapter.fact(factRequest);
        factEnvelopes.push(envelope);
        if (onModelEnvelope) await onModelEnvelope({ phase: 'fact', envelope });
        fact = assertSchema(contracts.validateFact, assertCompletedModelEnvelope(envelope), 'FACT_SCHEMA_INVALID');
      }
      evidence = evidenceGate(fact, pages, hostname);

      phraseRequest = await buildPhraseRequest(root, fact, offerProfile, phraseModelSettings);
      phraseRequests.push(phraseRequest);
      await reserveModelBudget();
      let envelope = await modelAdapter.phrase(phraseRequest);
      phraseEnvelopes.push(envelope);
      if (onModelEnvelope) await onModelEnvelope({ phase: 'phrase', envelope });
      phrase = assertSchema(contracts.validatePhrase, assertCompletedModelEnvelope(envelope), 'PHRASE_SCHEMA_INVALID');
      try {
        business = businessGate(phrase, offerProfile);
      } catch (error) {
        const firstFailure = asSafeResult(error);
        if (firstFailure.code === 'PHRASE_SENTENCE_COUNT') {
          const repaired = { ...phrase, personalization_phrase: repairPhraseFormatting(phrase.personalization_phrase) };
          try {
            business = businessGate(repaired, offerProfile);
            phrase = { ...repaired, warnings: [...(repaired.warnings ?? []), 'PHRASE_FORMAT_REPAIRED'] };
          } catch {
            business = null;
          }
        }
        if (!business && retryablePhraseFailure(firstFailure.code)) {
          phraseRequest = await buildPhraseRequest(root, fact, offerProfile, { ...phraseModelSettings, retryCode: firstFailure.code });
          phraseRequests.push(phraseRequest);
          envelope = await modelAdapter.phrase(phraseRequest);
          phraseEnvelopes.push(envelope);
          if (onModelEnvelope) await onModelEnvelope({ phase: 'phrase_retry', envelope });
          phrase = assertSchema(contracts.validatePhrase, assertCompletedModelEnvelope(envelope), 'PHRASE_SCHEMA_INVALID');
          business = businessGate(phrase, offerProfile);
          phrase = { ...phrase, warnings: [...(phrase.warnings ?? []), 'PHRASE_REGENERATED_AFTER_VALIDATION'] };
        }
        if (!business) throw error;
      }
    } catch (error) {
      const safe = asSafeResult(error);
      if (personalizationMode === 'required' || !optionalPersonalizationFailure(safe.code)) throw error;
      personalizationFailureCode = safe.code;
      fact = evidence ? fact : null;
      evidence = evidence ?? null;
      phrase = null;
      business = null;
    }
  }

  let aggregate;
  if (phrase && business && fact && evidence) {
    aggregate = {
      company_name: fact.company_name,
      fact: fact.fact,
      source_id: fact.source_id,
      source_excerpt: compactEvidenceExcerpt(evidence.source.text, fact.fact),
      source_type: fact.source_type,
      published_at: evidence.publishedAt,
      personalization_phrase: phrase.personalization_phrase,
      personalization_mode: 'PERSONALIZED',
      overlap: phrase.overlap,
      offer_claim_ids: phrase.offer_claim_ids,
      word_count: wordCount(phrase.personalization_phrase),
      confidence: fact.confidence,
      decision: 'READY_FOR_REVIEW',
      warnings: [...(fact.warnings ?? []), ...evidence.warnings, ...(phrase.warnings ?? [])],
    };
    if (!business.targetRange) aggregate.warnings.push('PHRASE_OUTSIDE_TARGET_25_35');
  } else {
    const fallbackSource = evidence?.source
      ?? pages.find((page) => page.source_id === contactDecision.selected.source_id)
      ?? pages[0];
    const universalOpening = template.manifest.universal_opening;
    aggregate = {
      company_name: normalizeWhitespace(fact?.company_name ?? fallbackSource.title ?? hostname).slice(0, 200),
      fact: evidence && fact ? fact.fact : null,
      source_id: evidence && fact ? fact.source_id : fallbackSource.source_id,
      source_excerpt: evidence && fact
        ? compactEvidenceExcerpt(evidence.source.text, fact.fact)
        : safeSourceExcerpt(fallbackSource),
      source_type: evidence && fact ? fact.source_type : fallbackSource.source_type,
      published_at: evidence && fact ? evidence.publishedAt : null,
      personalization_phrase: universalOpening,
      personalization_mode: personalizationMode === 'off' ? 'UNIVERSAL_ONLY' : 'UNIVERSAL_FALLBACK',
      overlap: null,
      offer_claim_ids: [],
      word_count: wordCount(universalOpening),
      confidence: null,
      decision: 'READY_FOR_REVIEW',
      warnings: personalizationMode === 'off'
        ? ['PERSONALIZATION_DISABLED']
        : ['PERSONALIZATION_SKIPPED', `PERSONALIZATION_REASON_${personalizationFailureCode ?? 'UNAVAILABLE'}`],
    };
  }
  if (crawl.skippedPages.some((page) => page.code === 'FETCH_HTTP_STATUS')) aggregate.warnings.push('OPTIONAL_PAGE_NOT_FOUND_SKIPPED');
  if (crawl.skippedPages.some((page) => page.code === 'FETCH_TIMEOUT')) aggregate.warnings.push('OPTIONAL_PAGE_TIMEOUT_SKIPPED');
  assertSchema(contracts.validateAggregate, aggregate, 'AGGREGATE_SCHEMA_INVALID');

  const draft = renderDraft(template, {
    OPENING_PARAGRAPH: aggregate.personalization_phrase,
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
      fact_request_sha256: factRequest ? sha256(stableJson(factRequest)) : null,
      phrase_request_sha256: phraseRequests.length ? sha256(stableJson(phraseRequests)) : null,
      fact_prompt_version: factRequest?.metadata.prompt_version ?? 'universal-source.v1',
      fact_prompt_sha256: factRequest?.metadata.prompt_sha256 ?? sha256('universal-source.v1'),
      fact_schema_sha256: factRequest?.metadata.schema_sha256 ?? sha256(stableJson(contracts.factSchema)),
      phrase_prompt_version: phraseRequest?.metadata.prompt_version ?? 'universal-opening.v1',
      phrase_prompt_sha256: phraseRequest?.metadata.prompt_sha256 ?? sha256(template.manifest.universal_opening),
      phrase_schema_sha256: phraseRequest?.metadata.schema_sha256 ?? sha256(stableJson(contracts.phraseSchema)),
      aggregate_schema_version: 'analysis-result.v2',
      aggregate_schema_sha256: sha256(stableJson(contracts.aggregateSchema)),
      offer_version: offerProfile.version ?? null,
      offer_sha256: sha256(stableJson(offerProfile)),
      template_sha256: draft.template_sha256,
      source_content_sha256: source.content_sha256,
      evidence_checks: evidence?.checks ?? ['loaded_source', 'contact_provenance', 'no_synthesized_fact'],
      business_checks: business?.checks ?? ['owner_approved_universal_opening', 'template_separation'],
      fact_model: acceptedFact ? { model: 'reused-verified-fact', usage: null } : mergeModelMetadata(factEnvelopes),
      phrase_model: mergeModelMetadata(phraseEnvelopes),
      model_attempted: modelReserved,
      model_call_count: factEnvelopes.length + phraseEnvelopes.length,
      personalization_mode: aggregate.personalization_mode,
      personalization_failure_code: personalizationFailureCode,
    },
  };
}

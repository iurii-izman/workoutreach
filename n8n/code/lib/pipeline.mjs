import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crawlSite } from './crawl.mjs';
import { chooseContact, deduplicateContacts, extractContactsFromHtml } from './contacts.mjs';
import { SafeStop } from './errors.mjs';
import { businessGate, evidenceGate } from './gates.mjs';
import {
  assertCompletedModelEnvelope,
  assertSchema,
  buildFactRequest,
  buildPhraseRequest,
  loadModelContracts,
} from './model-contract.mjs';
import { sha256, stableJson, wordCount } from './normalize.mjs';
import { loadTemplate, renderDraft } from './templates.mjs';
import { renderTelegramPreview } from './telegram.mjs';

export function makeJobId(seed) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const digest = Buffer.from(sha256(String(seed)), 'hex');
  let suffix = '';
  for (let index = 0; index < 6; index += 1) suffix += alphabet[digest[index] % alphabet.length];
  return `WO-${suffix}`;
}

export async function loadOfferProfile(root, relative = 'product/offer-profile.v1.yaml') {
  return JSON.parse(await readFile(join(root, relative), 'utf8'));
}

export async function analyzeDryRun({ root, inputUrl, fetcher, modelAdapter, offerProfile, seed = inputUrl }) {
  if (!offerProfile || (!offerProfile.owner_approved && !offerProfile.synthetic_eval)) {
    throw new SafeStop('OFFER_NOT_APPROVED', 'An owner-approved or synthetic-eval offer profile is required');
  }
  const jobId = makeJobId(seed);
  const crawl = await crawlSite(inputUrl, fetcher);
  const contacts = deduplicateContacts(crawl.pages.flatMap((page) => extractContactsFromHtml(page._html, page)));
  const contactDecision = chooseContact(contacts);
  if (contactDecision.decision === 'NEEDS_CONTACT') throw new SafeStop('NEEDS_CONTACT', 'No eligible published contact address was found');
  if (contactDecision.decision === 'NEEDS_REVIEW') throw new SafeStop('NEEDS_REVIEW', 'Multiple or ambiguous contact addresses require operator selection');

  const pages = crawl.pages.map(({ _html, ...page }) => page);
  const hostname = new URL(crawl.root).hostname;
  const contracts = await loadModelContracts(root);
  const factRequest = await buildFactRequest(root, pages);
  const factEnvelope = await modelAdapter.fact(factRequest);
  const fact = assertSchema(contracts.validateFact, assertCompletedModelEnvelope(factEnvelope), 'FACT_SCHEMA_INVALID');
  const evidence = evidenceGate(fact, pages, hostname);

  const phraseRequest = await buildPhraseRequest(root, fact, offerProfile);
  const phraseEnvelope = await modelAdapter.phrase(phraseRequest);
  const phrase = assertSchema(contracts.validatePhrase, assertCompletedModelEnvelope(phraseEnvelope), 'PHRASE_SCHEMA_INVALID');
  const business = businessGate(phrase, offerProfile);

  const aggregate = {
    company_name: fact.company_name,
    fact: fact.fact,
    source_id: fact.source_id,
    source_excerpt: fact.source_excerpt,
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
  assertSchema(contracts.validateAggregate, aggregate, 'AGGREGATE_SCHEMA_INVALID');

  const template = await loadTemplate(root);
  const draft = renderDraft(template, {
    PERSONALIZATION_PHRASE: aggregate.personalization_phrase,
    COMPANY_NAME: aggregate.company_name,
    SENDER_NAME: 'OWNER_INPUT_REQUIRED',
    OPT_OUT_TEXT: 'OWNER_INPUT_REQUIRED',
  });
  if (draft.sendable) throw new SafeStop('DRY_RUN_TEMPLATE_SENDABLE', 'Stage-1 template must remain non-sendable');

  const source = pages.find((page) => page.source_id === aggregate.source_id);
  const warnings = [...aggregate.warnings, template.manifest.notice, 'Telegram transport is stubbed; no message was transmitted'];
  const preview = renderTelegramPreview({
    jobId,
    siteUrl: crawl.root,
    recipient: contactDecision.selected,
    analysis: aggregate,
    draft,
    source,
    warnings,
  });

  return {
    ok: true,
    mode: 'offline-stub',
    job_id: jobId,
    status: 'DRAFT_READY',
    crawl: { page_count: pages.length, total_chars: crawl.totalChars, pages },
    contact: contactDecision,
    analysis: aggregate,
    draft,
    telegram_preview: preview,
    safety: { live_send_enabled: false, mail_transport: 'disabled', transmitted: false, outbox_created: false },
    evidence: {
      fact_request_sha256: sha256(stableJson(factRequest)),
      phrase_request_sha256: sha256(stableJson(phraseRequest)),
      offer_sha256: sha256(stableJson(offerProfile)),
      template_sha256: draft.template_sha256,
      source_content_sha256: source.content_sha256,
      evidence_checks: evidence.checks,
      business_checks: business.checks,
    },
  };
}

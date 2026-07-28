import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SafeStop } from './errors.mjs';
import { sha256, stableJson } from './normalize.mjs';

export async function loadJson(root, relative) {
  return JSON.parse(await readFile(join(root, relative), 'utf8'));
}

export async function loadModelContracts(root) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { date: /^\d{4}-\d{2}-\d{2}$/u } });
  const factSchema = await loadJson(root, 'schemas/fact-extraction.v1.schema.json');
  const phraseSchema = await loadJson(root, 'schemas/phrase-generation.v1.schema.json');
  const aggregateSchema = await loadJson(root, 'schemas/analysis-result.v2.schema.json');
  return {
    factSchema,
    phraseSchema,
    aggregateSchema,
    validateFact: ajv.compile(factSchema),
    validatePhrase: ajv.compile(phraseSchema),
    validateAggregate: ajv.compile(aggregateSchema),
  };
}

export function assertSchema(validate, value, code) {
  if (!validate(value)) {
    throw new SafeStop(code, 'Model result did not match its canonical schema', {
      errors: validate.errors.map(({ instancePath, keyword }) => ({ instancePath, keyword })),
    });
  }
  return value;
}

function modelSettings(settings = {}) {
  return {
    model: settings.model ?? 'gpt-5.6-luna',
    effort: settings.effort ?? 'low',
    maxOutputTokens: settings.maxOutputTokens ?? 2200,
    promptCacheMode: settings.promptCacheMode ?? null,
  };
}

function promptCacheOptions(mode) {
  if (mode == null || mode === 'auto') return {};
  if (mode !== 'explicit') throw new SafeStop('MODEL_CONFIG_INVALID', 'Prompt cache mode must be auto or explicit');
  // Company source payloads are normally unique. Explicit mode without a
  // breakpoint prevents an implicit one-off GPT-5.6 cache write while keeping
  // the option to add a stable breakpoint after measured reuse is available.
  return { prompt_cache_options: { mode: 'explicit' } };
}

function openAITransportSchema(schema) {
  const transport = structuredClone(schema);
  delete transport.$schema;
  delete transport.$id;
  const stripUnsupportedAnnotations = (value) => {
    if (Array.isArray(value)) {
      value.forEach(stripUnsupportedAnnotations);
      return;
    }
    if (!value || typeof value !== 'object') return;
    delete value.uniqueItems;
    Object.values(value).forEach(stripUnsupportedAnnotations);
  };
  stripUnsupportedAnnotations(transport);
  return transport;
}

export async function buildFactRequest(root, pages, settings = {}) {
  const schema = await loadJson(root, 'schemas/fact-extraction.v1.schema.json');
  const prompt = await readFile(join(root, 'prompts/fact-extraction/v2.md'), 'utf8');
  const configured = typeof settings === 'string' ? modelSettings({ model: settings }) : modelSettings(settings);
  return {
    model: configured.model,
    store: false,
    reasoning: { effort: configured.effort },
    max_output_tokens: configured.maxOutputTokens,
    truncation: 'disabled',
    tools: [],
    ...promptCacheOptions(configured.promptCacheMode),
    instructions: prompt,
    input: [{ role: 'user', content: JSON.stringify({ sources: pages.map(({ source_id, source_type, title, text }) => ({ source_id, source_type, title, text })) }) }],
    text: { format: { type: 'json_schema', name: 'workoutreach_fact_v1', strict: true, schema: openAITransportSchema(schema) } },
    metadata: { prompt_version: 'fact-extraction.v2', prompt_sha256: sha256(prompt), schema_sha256: sha256(stableJson(schema)) },
  };
}

export async function buildPhraseRequest(root, fact, offerProfile, settings = {}) {
  const schema = await loadJson(root, 'schemas/phrase-generation.v1.schema.json');
  const prompt = await readFile(join(root, 'prompts/phrase-generation/v1.md'), 'utf8');
  const configured = typeof settings === 'string' ? modelSettings({ model: settings }) : modelSettings(settings);
  return {
    model: configured.model,
    store: false,
    reasoning: { effort: configured.effort },
    max_output_tokens: configured.maxOutputTokens,
    truncation: 'disabled',
    tools: [],
    ...promptCacheOptions(configured.promptCacheMode),
    instructions: prompt,
    input: [{
      role: 'user',
      content: JSON.stringify({
        accepted_fact: fact.fact,
        source_excerpt: fact.source_excerpt,
        source_type: fact.source_type,
        offer_profile: offerProfile,
        locale: offerProfile.locale,
        phrase_word_limits: { target_min: 25, target_max: 35, hard_min: 18, hard_max: 40 },
        ...(settings.retryCode ? {
          retry_context: {
            previous_failure: String(settings.retryCode),
            instruction: 'Return a fresh single-sentence variant that fixes only the stated validation failure.',
          },
        } : {}),
      }),
    }],
    text: { format: { type: 'json_schema', name: 'workoutreach_phrase_v1', strict: true, schema: openAITransportSchema(schema) } },
    metadata: { prompt_version: 'phrase-generation.v1', prompt_sha256: sha256(prompt), schema_sha256: sha256(stableJson(schema)) },
  };
}

export function assertCompletedModelEnvelope(envelope) {
  if (!envelope || envelope.status !== 'completed') throw new SafeStop('MODEL_INCOMPLETE', 'Model response was incomplete');
  if (envelope.refusal) throw new SafeStop('MODEL_REFUSAL', 'Model refused the request');
  if (!envelope.output) throw new SafeStop('MODEL_OUTPUT_MISSING', 'Model response did not contain structured output');
  return envelope.output;
}

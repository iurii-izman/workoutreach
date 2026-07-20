import { SafeStop } from './errors.mjs';

function assertSafeRequest(request) {
  if (request?.store !== false) throw new SafeStop('MODEL_REQUEST_UNSAFE', 'OpenAI request must set store=false');
  if (!Array.isArray(request.tools) || request.tools.length !== 0) throw new SafeStop('MODEL_REQUEST_UNSAFE', 'OpenAI request must not expose tools');
  if (request.text?.format?.type !== 'json_schema' || request.text.format.strict !== true) {
    throw new SafeStop('MODEL_REQUEST_UNSAFE', 'OpenAI request must use strict JSON Schema output');
  }
  if (request.truncation !== 'disabled') throw new SafeStop('MODEL_REQUEST_UNSAFE', 'OpenAI request truncation must be disabled');
}

function collectResponse(response) {
  const refusals = [];
  const outputTexts = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' && content.refusal) refusals.push(content.refusal);
      if (content.type === 'output_text' && typeof content.text === 'string') outputTexts.push(content.text);
    }
  }
  if (refusals.length) {
    return { status: response.status ?? 'completed', refusal: 'MODEL_REFUSED', output: null, metadata: safeMetadata(response) };
  }
  if (response.status !== 'completed') {
    return { status: response.status ?? 'incomplete', refusal: null, output: null, incomplete_details: response.incomplete_details ?? null, metadata: safeMetadata(response) };
  }
  if (outputTexts.length !== 1) throw new SafeStop('MODEL_OUTPUT_COUNT', 'OpenAI response did not contain exactly one structured output');
  let output;
  try {
    output = JSON.parse(outputTexts[0]);
  } catch {
    throw new SafeStop('MODEL_OUTPUT_JSON_INVALID', 'OpenAI structured output was not valid JSON');
  }
  return { status: 'completed', refusal: null, output, metadata: safeMetadata(response) };
}

function safeMetadata(response) {
  const inputDetails = response.usage?.input_tokens_details;
  const outputDetails = response.usage?.output_tokens_details;
  return {
    response_id: typeof response.id === 'string' ? response.id : null,
    model: typeof response.model === 'string' ? response.model : null,
    service_tier: typeof response.service_tier === 'string' ? response.service_tier : null,
    usage: response.usage ? {
      input_tokens: response.usage.input_tokens ?? null,
      output_tokens: response.usage.output_tokens ?? null,
      total_tokens: response.usage.total_tokens ?? null,
      input_tokens_details: inputDetails ? {
        cached_tokens: inputDetails.cached_tokens ?? null,
        cache_write_tokens: inputDetails.cache_write_tokens ?? null,
      } : null,
      output_tokens_details: outputDetails ? {
        reasoning_tokens: outputDetails.reasoning_tokens ?? null,
      } : null,
    } : null,
  };
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createOpenAIAdapter({ apiKey, fetchImpl = globalThis.fetch, baseUrl = 'https://api.openai.com/v1', timeoutMs = 30_000, maxRetries = 2, sleep = defaultSleep, random = Math.random } = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 20) throw new SafeStop('OPENAI_CREDENTIAL_MISSING', 'A valid OpenAI API key is required for live evaluation');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  async function invoke(request) {
    assertSafeRequest(request);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        response = await fetchImpl(`${baseUrl}/responses`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (error) {
        if (attempt < maxRetries && (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error instanceof TypeError)) {
          await sleep(250 * (2 ** attempt) + Math.floor(random() * 100));
          continue;
        }
        throw new SafeStop('OPENAI_NETWORK_ERROR', 'OpenAI request failed before a safe response was received');
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        if (attempt < maxRetries && retryableStatus(response.status)) {
          await response.body?.cancel?.().catch(() => {});
          await sleep(250 * (2 ** attempt) + Math.floor(random() * 100));
          continue;
        }
        const errorBody = await response.json().catch(() => null);
        throw new SafeStop('OPENAI_HTTP_ERROR', 'OpenAI returned a non-success status', {
          status: response.status,
          request_id: response.headers?.get?.('x-request-id') ?? null,
          type: typeof errorBody?.error?.type === 'string' ? errorBody.error.type : null,
          code: typeof errorBody?.error?.code === 'string' ? errorBody.error.code : null,
          param: typeof errorBody?.error?.param === 'string' ? errorBody.error.param : null,
        });
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new SafeStop('OPENAI_RESPONSE_INVALID', 'OpenAI returned an unreadable response');
      }
      return collectResponse(payload);
    }
    throw new SafeStop('OPENAI_RETRY_EXHAUSTED', 'OpenAI retry budget was exhausted');
  }

  return { fact: invoke, phrase: invoke };
}

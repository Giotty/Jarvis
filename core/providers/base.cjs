const crypto = require('node:crypto');
const { category, safeError, trace, requestTrace, metadata } = require('./diagnostics.cjs');
class ProviderError extends Error {
  constructor(code, retryable = true) {
    super(`AI provider unavailable (${code}). Check provider settings or use local fallback.`);
    this.code = code;
    this.retryable = retryable;
    this.category = category(code);
  }
}
class AIProvider {
  constructor({ config, secrets, fetcher = fetch }) {
    Object.assign(this, { config, secrets, fetcher });
  }
  async chat() {
    throw new ProviderError('not_implemented', false);
  }
  stream(messages, tools, vision, signal, onDelta, options) {
    return this.chat(messages, tools, vision, signal, onDelta, options);
  }
  async models() {
    return { online: false, models: [] };
  }
  async capabilities(model) {
    return this.config().providerCapabilities?.[this.id + ':' + model] || ['TEXT', 'STREAMING'];
  }
  toolCalling(messages, tools, signal, onDelta) {
    return this.chat(messages, tools, false, signal, onDelta);
  }
  vision(messages, signal, onDelta) {
    return this.chat(messages, undefined, true, signal, onDelta);
  }
  structuredOutput(messages, schema, signal) {
    return this.chat(messages, undefined, false, signal, undefined, { schema });
  }
  reasoning(messages, signal, onDelta) {
    return this.chat(messages, undefined, false, signal, onDelta, { reasoning: true });
  }
  usage(reply) {
    return reply.usage || { input: 0, output: 0 };
  }
  cancel(controller) {
    controller.abort();
  }
  async request(url, body, headers, signal, options = {}) {
    const diagnostic = requestTrace(this, url, body);
    trace(this, 'http-request', diagnostic);
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(
      Math.max(
        1,
        Math.min(120000, options.requestTimeout || this.config().providerTimeout || 45000),
      ),
    );
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetcher(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: combined,
        redirect: 'error',
      });
    } catch {
      signal?.throwIfAborted();
      trace(this, 'http-error', { ...diagnostic, code: timeout.aborted ? 'timeout' : 'network' });
      throw new ProviderError(timeout.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      const raw = await response.clone().text();
      let detail;
      try {
        detail = JSON.parse(raw);
      } catch {
        detail = { message: raw };
      }
      trace(this, 'http-error', {
        ...diagnostic,
        status: response.status,
        error: safeError(
          detail.error?.message ||
            (typeof detail.error === 'string' ? detail.error : '') ||
            detail.detail ||
            detail.message,
        ),
        errorType: safeError(detail.error?.type),
        errorCode: safeError(detail.error?.code),
      });
      if (response.status === 429 && this.rateLimited)
        await this.rateLimited(response, body?.model);
      const error = new ProviderError(
        /unsupported|unknown|not supported|unexpected.*parameter/i.test(
          detail.error?.message || detail.message || '',
        ) && [400, 422].includes(response.status)
          ? 'unsupported_parameter'
          : 'http_' + response.status,
        response.status === 429 || response.status >= 500,
      );
      error.diagnostic = {
        ...diagnostic,
        status: response.status,
        error: safeError(
          detail.error?.message ||
            (typeof detail.error === 'string' ? detail.error : '') ||
            detail.detail ||
            detail.message,
        ),
      };
      throw error;
    }
    metadata.set(response, { provider: this, diagnostic, timeout });
    trace(this, 'http-response', { ...diagnostic, status: response.status });
    return response;
  }
  key() {
    const value = this.secrets.get(this.id);
    if (!value) throw new ProviderError('missing_key', false);
    return value;
  }
}
async function json(response) {
  try {
    const data = await response.json();
    const m = metadata.get(response);
    if (m)
      trace(m.provider, 'response-parsed', {
        ...m.diagnostic,
        finish: data.choices?.[0]?.finish_reason,
        contentLength: data.choices?.[0]?.message?.content?.length || 0,
        reasoningLength: data.choices?.[0]?.message?.reasoning_content?.length || 0,
        toolCount: data.choices?.[0]?.message?.tool_calls?.length || 0,
        responseKeys: Object.keys(data),
      });
    return data;
  } catch {
    throw new ProviderError(
      metadata.get(response)?.timeout.aborted ? 'timeout' : 'malformed_response',
    );
  }
}
async function sse(response, consume, signal) {
  let buffer = '';
  const decoder = new TextDecoder();
  const frame = (block) => {
    signal?.throwIfAborted();
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    try {
      const event = JSON.parse(data);
      const m = metadata.get(response);
      if (m && event.choices?.[0]?.delta?.tool_calls)
        trace(m.provider, 'stream-tools', {
          ...m.diagnostic,
          finish: event.choices[0].finish_reason,
          indices: event.choices[0].delta.tool_calls.map((t) => ({
            index: t.index,
            name: t.function?.name,
            keys: Object.keys(t),
          })),
        });
      if (event.error) throw new ProviderError(event.error.code === 429 ? 'http_429' : 'http_500');
      consume(event);
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      const m = metadata.get(response);
      if (m)
        trace(m.provider, 'stream-error', {
          ...m.diagnostic,
          code: error.code || 'malformed_stream',
          error: safeError(error.message),
        });
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('malformed_stream');
    }
  };
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
      if (buffer.length > 2e6) throw new ProviderError('response_too_large');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        frame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) frame(buffer);
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    const m = metadata.get(response);
    throw error instanceof ProviderError
      ? error
      : new ProviderError(m?.timeout.aborted ? 'timeout' : 'stream_interrupted');
  }
}
function calls(calls = []) {
  return calls.map((call) => {
    let args = call.function?.arguments;
    try {
      if (typeof args === 'string') args = JSON.parse(args);
    } catch {
      args = { _invalidJSON: true };
    }
    return {
      id: call.id || crypto.randomUUID(),
      function: { name: call.function?.name || '', arguments: args || {} },
    };
  });
}
module.exports = { AIProvider, ProviderError, json, sse, calls };

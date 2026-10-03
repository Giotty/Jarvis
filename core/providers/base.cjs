const crypto = require('node:crypto');
class ProviderError extends Error {
  constructor(code, retryable = true) {
    super(`AI provider unavailable (${code}). Check provider settings or use local fallback.`);
    this.code = code;
    this.retryable = retryable;
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
  async request(url, body, headers, signal) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this.config().providerTimeout || 45000);
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
      throw new ProviderError(timeout.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      if (response.status === 429 && this.rateLimited) await this.rateLimited(response);
      throw new ProviderError(
        'http_' + response.status,
        response.status === 429 || response.status >= 500,
      );
    }
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
    return await response.json();
  } catch {
    throw new ProviderError('malformed_response');
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
      consume(JSON.parse(data));
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
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
    throw error instanceof ProviderError ? error : new ProviderError('stream_interrupted');
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

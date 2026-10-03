const { AIProvider, ProviderError, json, sse, calls } = require('./base.cjs');
function input(messages) {
  const contents = [],
    known = new Map();
  const append = (role, parts) => {
    if (!parts.length) return;
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m._native?.gemini) {
      const native = m._native.gemini;
      let i = 0;
      for (const part of native.parts)
        if (part.functionCall) {
          const call = m.tool_calls?.[i++];
          if (call) known.set(call.id, { name: part.functionCall.name, id: part.functionCall.id });
        }
      append('model', structuredClone(native.parts));
      continue;
    }
    if (m.role === 'tool' && known.has(m.tool_call_id)) {
      const target = known.get(m.tool_call_id);
      let response;
      try {
        response = JSON.parse(m.content);
      } catch {
        response = { result: m.content };
      }
      append('user', [
        {
          functionResponse: {
            name: target.name,
            ...(target.id ? { id: target.id } : {}),
            response,
          },
        },
      ]);
      continue;
    }
    const parts = [];
    if (m.content)
      parts.push({ text: m.role === 'tool' ? 'Untrusted observation: ' + m.content : m.content });
    for (const image of m.images || []) {
      const parsed = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(image);
      parts.push({
        inlineData: { mimeType: parsed?.[1] || 'image/jpeg', data: parsed?.[2] || image },
      });
    }
    for (const call of m.tool_calls || []) {
      known.set(call.id, { name: call.function.name, id: call.id });
      parts.push({
        functionCall: { id: call.id, name: call.function.name, args: call.function.arguments },
      });
    }
    append(m.role === 'assistant' ? 'model' : 'user', parts);
  }
  return contents;
}
function normalize(response) {
  const candidate = response?.candidates?.[0],
    native = candidate?.content;
  if (!native?.parts || !['STOP', undefined].includes(candidate.finishReason))
    throw new ProviderError('incomplete_response');
  const content = native.parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('');
  const tool_calls = calls(
    native.parts
      .filter((p) => p.functionCall)
      .map((p) => ({
        id: p.functionCall.id,
        function: { name: p.functionCall.name, arguments: p.functionCall.args || {} },
      })),
  );
  if (!content && !tool_calls.length) throw new ProviderError('empty_response');
  return {
    role: 'assistant',
    content,
    tool_calls,
    _native: { gemini: native },
    usage: {
      input: response.usageMetadata?.promptTokenCount || 0,
      output:
        (response.usageMetadata?.candidatesTokenCount || 0) +
        (response.usageMetadata?.thoughtsTokenCount || 0),
    },
  };
}
class GeminiProvider extends AIProvider {
  id = 'gemini';
  headers() {
    return { 'x-goog-api-key': this.key() };
  }
  async models(signal) {
    try {
      const models = [];
      let token;
      for (let page = 0; page < 5; page++) {
        const r = await json(
          await this.request(
            'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100' +
              (token ? '&pageToken=' + encodeURIComponent(token) : ''),
            null,
            this.headers(),
            signal,
          ),
        );
        models.push(
          ...(r.models || [])
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m) => m.name.replace(/^models\//, '')),
        );
        token = r.nextPageToken;
        if (!token) break;
      }
      return { online: true, models };
    } catch {
      signal?.throwIfAborted();
      return { online: false, models: [] };
    }
  }
  async chat(messages, tools, vision, signal, onDelta, options = {}) {
    const c = this.config(),
      model = (vision && c.geminiVisionModel) || c.geminiModel;
    if (!/^(?:models\/)?[A-Za-z0-9._-]+$/.test(model || ''))
      throw new ProviderError('missing_model', false);
    const body = {
      systemInstruction: {
        parts: [
          {
            text: messages
              .filter((m) => m.role === 'system')
              .map((m) => m.content)
              .join('\n'),
          },
        ],
      },
      contents: input(messages),
      ...(tools?.length
        ? {
            tools: [
              {
                functionDeclarations: tools.map(({ function: f }) => {
                  const { $schema: _schema, ...parametersJsonSchema } = f.parameters;
                  return { name: f.name, description: f.description, parametersJsonSchema };
                }),
              },
            ],
          }
        : {}),
      generationConfig: {
        maxOutputTokens: 4096,
        ...(options.schema
          ? { responseMimeType: 'application/json', responseJsonSchema: options.schema }
          : {}),
      },
    };
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model.replace(/^models\//, '')) +
      ':' +
      (onDelta ? 'streamGenerateContent?alt=sse' : 'generateContent');
    const response = await this.request(url, body, this.headers(), signal);
    if (!onDelta) return normalize(await json(response));
    const parts = [];
    let final = {};
    await sse(
      response,
      (frame) => {
        if (frame.error) throw new ProviderError('stream_failed');
        const candidate = frame.candidates?.[0];
        for (const part of candidate?.content?.parts || []) {
          // Preserve signatures even on empty text chunks and keep call order exact.
          parts.push(part);
          if (part.text && !part.thought) onDelta(part.text);
        }
        if (candidate?.finishReason) final = { ...final, finishReason: candidate.finishReason };
        if (frame.usageMetadata) final.usageMetadata = frame.usageMetadata;
      },
      signal,
    );
    if (!final.finishReason) throw new ProviderError('incomplete_stream');
    return normalize({
      candidates: [{ content: { role: 'model', parts }, finishReason: final.finishReason }],
      usageMetadata: final.usageMetadata,
    });
  }
}
module.exports = { GeminiProvider, input, normalize };

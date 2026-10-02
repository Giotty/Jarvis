const { AIProvider, ProviderError, json, sse, calls } = require('./base.cjs');
function input(messages) {
  const out = [],
    known = new Set();
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant' && m._native?.openai) {
      out.push(...m._native.openai);
      m.tool_calls?.forEach((c) => known.add(c.id));
      continue;
    }
    if (m.role === 'tool') {
      if (known.has(m.tool_call_id))
        out.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content });
      else out.push({ role: 'user', content: 'Untrusted observation: ' + m.content });
      continue;
    }
    if (m.content || m.images?.length)
      out.push({
        role: m.role,
        content: m.images?.length
          ? [
              { type: 'input_text', text: m.content || 'Screen observation' },
              ...m.images.map((image) => ({
                type: 'input_image',
                image_url: image.startsWith('data:') ? image : 'data:image/jpeg;base64,' + image,
              })),
            ]
          : m.content,
      });
    for (const c of m.tool_calls || []) {
      known.add(c.id);
      out.push({
        type: 'function_call',
        call_id: c.id,
        name: c.function.name,
        arguments: JSON.stringify(c.function.arguments),
      });
    }
  }
  return out;
}
function normalize(response) {
  if (!Array.isArray(response?.output) || (response.status && response.status !== 'completed'))
    throw new ProviderError('incomplete_response');
  const content = response.output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .map((o) => o.text || o.refusal || '')
    .join('');
  const tool_calls = calls(
    response.output
      .filter((o) => o.type === 'function_call')
      .map((o) => ({ id: o.call_id, function: { name: o.name, arguments: o.arguments } })),
  );
  if (!content && !tool_calls.length) throw new ProviderError('empty_response');
  return {
    role: 'assistant',
    content,
    tool_calls,
    _native: { openai: response.output },
    usage: { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 },
  };
}
class OpenAIProvider extends AIProvider {
  id = 'openai';
  async models(signal) {
    try {
      const r = await json(
        await this.request(
          this.config().openaiUrl.replace(/\/$/, '') + '/models',
          null,
          { Authorization: 'Bearer ' + this.key() },
          signal,
        ),
      );
      return { online: true, models: r.data.map((m) => m.id) };
    } catch {
      return { online: false, models: [] };
    }
  }
  async chat(messages, tools, vision, signal, onDelta, options = {}) {
    const c = this.config(),
      model = vision ? c.openaiVisionModel || c.openaiModel : c.openaiModel;
    if (!model) throw new ProviderError('missing_model', false);
    const body = {
      model,
      instructions: messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n'),
      input: input(messages),
      store: false,
      include: ['reasoning.encrypted_content'],
      stream: Boolean(onDelta),
      ...(tools?.length
        ? {
            tools: tools.map(({ function: f }) => ({ type: 'function', ...f, strict: false })),
            parallel_tool_calls: c.parallelTools !== false,
          }
        : {}),
      ...(options.schema
        ? {
            text: {
              format: {
                type: 'json_schema',
                name: 'jarvis_output',
                schema: options.schema,
                strict: true,
              },
            },
          }
        : {}),
    };
    const response = await this.request(
      c.openaiUrl.replace(/\/$/, '') + '/responses',
      body,
      { Authorization: 'Bearer ' + this.key() },
      signal,
    );
    if (!onDelta) return normalize(await json(response));
    let final;
    await sse(
      response,
      (event) => {
        if (event.type === 'response.output_text.delta') onDelta(event.delta);
        if (event.type === 'response.completed') final = event.response;
        if (['error', 'response.failed', 'response.incomplete'].includes(event.type))
          throw new ProviderError('stream_failed');
      },
      signal,
    );
    return normalize(final);
  }
}
module.exports = { OpenAIProvider, input, normalize };

const { AIProvider, ProviderError, json, sse, calls } = require('./base.cjs');
function input(messages) {
  const out = [],
    known = new Set();
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content = [];
    if (m.role === 'tool' && known.has(m.tool_call_id))
      content = [
        {
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: m.content,
          is_error: /"success":false/.test(m.content),
        },
      ];
    else if (m._native?.anthropic) content = m._native.anthropic;
    else {
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const image of m.images || [])
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: image.replace(/^data:image\/[^;]+;base64,/, ''),
          },
        });
      for (const call of m.tool_calls || [])
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: call.function.arguments,
        });
    }
    m.tool_calls?.forEach((call) => known.add(call.id));
    if (!content.length) continue;
    if (out.at(-1)?.role === role) out.at(-1).content.push(...content);
    else out.push({ role, content: [...content] });
  }
  return out;
}
function normalize(response) {
  if (
    !Array.isArray(response?.content) ||
    !response.stop_reason ||
    response.stop_reason === 'max_tokens'
  )
    throw new ProviderError('incomplete_response');
  const content = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const tool_calls = calls(
    response.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, function: { name: b.name, arguments: b.input } })),
  );
  if (!content && !tool_calls.length) throw new ProviderError('empty_response');
  return {
    role: 'assistant',
    content,
    tool_calls,
    _native: { anthropic: response.content },
    usage: { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 },
  };
}
class ClaudeProvider extends AIProvider {
  id = 'anthropic';
  headers() {
    return { 'x-api-key': this.key(), 'anthropic-version': '2023-06-01' };
  }
  async models(signal) {
    try {
      const r = await json(
        await this.request('https://api.anthropic.com/v1/models', null, this.headers(), signal),
      );
      return { online: true, models: r.data.map((m) => m.id) };
    } catch {
      return { online: false, models: [] };
    }
  }
  async chat(messages, tools, _vision, signal, onDelta, options = {}) {
    const c = this.config();
    if (!c.anthropicModel) throw new ProviderError('missing_model', false);
    const body = {
      model: c.anthropicModel,
      max_tokens: 2048,
      system: messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n'),
      messages: input(messages),
      stream: Boolean(onDelta),
      ...(tools?.length
        ? {
            tools: tools.map(({ function: f }) => ({
              name: f.name,
              description: f.description,
              input_schema: f.parameters,
            })),
          }
        : {}),
      ...(options.schema
        ? { output_config: { format: { type: 'json_schema', schema: options.schema } } }
        : {}),
    };
    const response = await this.request(
      'https://api.anthropic.com/v1/messages',
      body,
      this.headers(),
      signal,
    );
    if (!onDelta) return normalize(await json(response));
    let result,
      done = false;
    const fragments = new Map();
    await sse(
      response,
      (event) => {
        if (event.type === 'error') throw new ProviderError('stream_failed');
        if (event.type === 'message_start') result = { ...event.message, content: [] };
        if (event.type === 'content_block_start')
          result.content[event.index] = { ...event.content_block };
        if (event.type === 'content_block_delta') {
          const block = result.content[event.index],
            delta = event.delta;
          if (delta.type === 'text_delta') {
            block.text += delta.text;
            onDelta(delta.text);
          }
          if (delta.type === 'input_json_delta')
            fragments.set(event.index, (fragments.get(event.index) || '') + delta.partial_json);
          if (delta.type === 'thinking_delta')
            block.thinking = (block.thinking || '') + delta.thinking;
          if (delta.type === 'signature_delta')
            block.signature = (block.signature || '') + delta.signature;
        }
        if (event.type === 'content_block_stop' && fragments.has(event.index))
          result.content[event.index].input = JSON.parse(fragments.get(event.index));
        if (event.type === 'message_delta') {
          Object.assign(result, event.delta);
          Object.assign(result.usage, event.usage);
        }
        if (event.type === 'message_stop') done = true;
      },
      signal,
    );
    if (!done) throw new ProviderError('incomplete_stream');
    return normalize(result);
  }
}
module.exports = { ClaudeProvider, input, normalize };

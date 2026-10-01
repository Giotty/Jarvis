class Ollama {
  constructor(config) {
    this.config = config;
  }
  async request(route, body, signal, onDelta) {
    const r = await fetch(this.config().ollamaUrl + route, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(body ? 120000 : 5000)])
        : AbortSignal.timeout(body ? 120000 : 5000),
    });
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      throw Error(`Ollama returned ${r.status}: ${detail.error || r.statusText}`);
    }
    if (!onDelta) return r.json();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    const message = { role: 'assistant', content: '', tool_calls: [] };
    const consume = (line) => {
      if (!line.trim()) return;
      const frame = JSON.parse(line);
      if (frame.error) throw Error(frame.error);
      if (frame.message?.content) {
        message.content += frame.message.content;
        onDelta(frame.message.content);
      }
      if (frame.message?.tool_calls) message.tool_calls.push(...frame.message.tool_calls);
      if (frame.done) finished = true;
    };
    for await (const chunk of r.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
    }
    buffer += decoder.decode();
    consume(buffer);
    if (!finished) throw Error('The model response ended before completion. Try again.');
    if (!message.tool_calls.length) delete message.tool_calls;
    return { message };
  }
  async models() {
    try {
      return { online: true, models: (await this.request('/api/tags')).models.map((m) => m.name) };
    } catch {
      return { online: false, models: [] };
    }
  }
  async chat(messages, tools, vision = false, signal, onDelta) {
    const c = this.config();
    const model = vision ? c.visionModel : c.model;
    if (!model) throw Error(`Select a ${vision ? 'vision' : 'chat'} model in Settings.`);
    return (
      await this.request(
        '/api/chat',
        {
          model,
          messages,
          tools,
          stream: Boolean(onDelta),
          keep_alive: '30m',
          ...(model.startsWith('qwen3') ? { think: false } : {}),
          options: { temperature: c.temperature, num_ctx: c.context, num_predict: 512 },
        },
        signal,
        onDelta,
      )
    ).message;
  }
  async warm() {
    const c = this.config();
    if (c.model)
      await this.request('/api/generate', {
        model: c.model,
        prompt: '',
        stream: false,
        keep_alive: '30m',
        options: { num_ctx: c.context },
      });
  }
}
module.exports = { Ollama };

class Ollama {
  constructor(config) {
    this.config = config;
  }
  async request(route, body, signal) {
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
    return r.json();
  }
  async models() {
    try {
      return { online: true, models: (await this.request('/api/tags')).models.map((m) => m.name) };
    } catch {
      return { online: false, models: [] };
    }
  }
  async chat(messages, tools, vision = false, signal) {
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
          stream: false,
          ...(model.startsWith('qwen3') ? { think: false } : {}),
          options: { temperature: c.temperature, num_ctx: c.context },
        },
        signal,
      )
    ).message;
  }
}
module.exports = { Ollama };

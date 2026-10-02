const { AIProvider, calls } = require('./base.cjs');
const { Ollama } = require('../ollama.cjs');
class OllamaProvider extends AIProvider {
  id = 'ollama';
  constructor(options) {
    super(options);
    this.local = options.local || new Ollama(options.config);
  }
  models() {
    return this.local.models();
  }
  async capabilities(model, signal) {
    const caps = await this.local.capabilities(model, signal);
    return [
      'TEXT',
      'STREAMING',
      'STRUCTURED_OUTPUT',
      ...(caps.includes('tools') ? ['TOOLS'] : []),
      ...(caps.includes('vision') ? ['VISION'] : []),
    ];
  }
  async chat(messages, tools, vision, signal, onDelta, options = {}) {
    const reply = await this.local.chat(
      messages.map(
        ({ _native: _n, _privacy: _p, _request: _r, usage: _u, finishReason: _f, ...m }) => m,
      ),
      tools,
      vision,
      signal,
      onDelta,
      options,
    );
    if (!reply || (typeof reply.content !== 'string' && !reply.tool_calls?.length))
      throw Error('Invalid Ollama response');
    return {
      ...reply,
      tool_calls: calls(reply.tool_calls),
      usage: reply.usage || { input: 0, output: 0 },
    };
  }
}
module.exports = { OllamaProvider };

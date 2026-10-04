const fs = require('node:fs'),
  path = require('node:path');
const { AIProvider, ProviderError, json, sse, calls } = require('./base.cjs');
const { catalog } = require('./nvidia-models.cjs');
const { HostedBudget } = require('./hosted-budget.cjs');
const { trace, metadata: responseMetadata } = require('./diagnostics.cjs');
const clean = (text) =>
  String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
function input(messages) {
  const out = [];
  // Several NIM chat templates keep only one system turn. Preserve both the
  // host JSON contract and the task instructions in that single turn.
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content || '')
    .join('\n\n');
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant' && m._native?.nvidia) {
      out.push(structuredClone(m._native.nvidia));
      continue;
    }
    const content = m.images?.length
      ? [
          { type: 'text', text: m.content || 'Describe the image' },
          ...m.images.map((image) => ({
            type: 'image_url',
            image_url: {
              url: image.startsWith('data:') ? image : 'data:image/jpeg;base64,' + image,
            },
          })),
        ]
      : m.content || '';
    out.push({
      role: m.role,
      content,
      ...(m.role === 'tool' ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls?.length
        ? {
            tool_calls: m.tool_calls.map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.function.name, arguments: JSON.stringify(t.function.arguments) },
            })),
          }
        : {}),
    });
  }
  return out;
}
function normalize(data) {
  const choice = data?.choices?.[0],
    m = choice?.message;
  if (!m || !['stop', 'tool_calls', 'length', undefined].includes(choice.finish_reason))
    throw new ProviderError('incomplete_response');
  const tool_calls = calls(m.tool_calls);
  const content = clean(m.content);
  if (!content && !tool_calls.length) throw new ProviderError('empty_response');
  if (tool_calls.some((t) => t.function.arguments?._invalidJSON))
    throw new ProviderError('malformed_tool_call');
  return {
    role: 'assistant',
    content,
    tool_calls,
    truncated: choice.finish_reason === 'length',
    _native: { nvidia: { ...m, content } },
    usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 },
  };
}
function compactContract(schema, depth = 0, root = schema) {
  if (schema.$ref?.startsWith('#/') && depth < 12) {
    const target = schema.$ref
      .slice(2)
      .split('/')
      .reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root);
    if (target) return compactContract(target, depth + 1, root);
  }
  const union = schema.anyOf || schema.oneOf;
  if (union?.length === 2 && union.some((s) => s.type === 'null'))
    return { anyOf: union.map((s) => compactContract(s, depth + 1, root)) };
  if (union || schema.$ref) return { type: 'object', additionalProperties: true };
  if (schema.type === 'array')
    return {
      type: 'array',
      items: compactContract(schema.items || {}, depth + 1, root),
      ...(schema.minItems !== undefined ? { minItems: schema.minItems } : {}),
      ...(schema.maxItems !== undefined ? { maxItems: schema.maxItems } : {}),
    };
  if (schema.type === 'object' || schema.properties)
    if (depth > 7) return { type: 'object', additionalProperties: true };
  if (schema.type === 'object' || schema.properties)
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(schema.properties || {}).map(([k, v]) => [
          k,
          compactContract(v, depth + 1, root),
        ]),
      ),
      ...(schema.required ? { required: schema.required } : {}),
      additionalProperties: schema.additionalProperties !== false,
    };
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => ['type', 'enum'].includes(key)),
  );
}
class ReasoningFilter {
  constructor() {
    this.buffer = '';
    this.thinking = false;
  }
  push(text, final = false) {
    this.buffer += text;
    let out = '';
    while (this.buffer.length) {
      const tag = this.thinking ? '</think>' : '<think>',
        i = this.buffer.toLowerCase().indexOf(tag);
      if (i >= 0) {
        if (!this.thinking) out += this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + tag.length);
        this.thinking = !this.thinking;
        continue;
      }
      const keep = final ? 0 : tag.length - 1;
      if (this.buffer.length <= keep) break;
      const part = this.buffer.slice(0, this.buffer.length - keep);
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      if (!this.thinking) out += part;
      break;
    }
    return out;
  }
}
class NvidiaProvider extends AIProvider {
  id = 'nvidia';
  constructor(options) {
    super(options);
    this.local = options.localNim === true;
    if (this.local) this.id = 'nim';
    this.file = options.directory && path.join(options.directory, this.id + '-capabilities.json');
    this.profiles = {};
    this.emit = options.emit || (() => {});
    this.budget = options.budget || new HostedBudget(options);
    if (this.file) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [model, p] of Object.entries(saved))
          if (
            typeof model === 'string' &&
            Array.isArray(p.caps) &&
            Number.isFinite(p.testedAt) &&
            p.testedAt > Date.now() - 7 * 86400000
          )
            this.profiles[model] = {
              caps: p.caps.filter((c) =>
                ['TEXT', 'STREAMING', 'TOOLS', 'VISION', 'STRUCTURED_OUTPUT', 'REASONING'].includes(
                  c,
                ),
              ),
              testedAt: p.testedAt,
              streamOnly: p.streamOnly === true,
              reasoningMode: ['max', 'low'].includes(p.reasoningMode) ? p.reasoningMode : undefined,
              schemaMode: p.schemaMode === 'prompt' ? 'prompt' : undefined,
              preferNonstream: p.preferNonstream === true,
              toolSchemaMode: p.toolSchemaMode === 'compact' ? 'compact' : undefined,
              status: p.status === 'available' ? 'available' : 'unavailable',
            };
      } catch {
        /* Unproven features stay disabled. */
      }
    }
  }
  base() {
    return this.local ? this.config().nimUrl : 'https://integrate.api.nvidia.com/v1';
  }
  headers() {
    return this.local ? {} : { Authorization: 'Bearer ' + this.key() };
  }
  saveProfiles() {
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.profiles));
      fs.renameSync(this.file + '.tmp', this.file);
    }
  }
  async capabilities(model) {
    return this.profiles[model]?.status === 'available' ? this.profiles[model].caps : ['TEXT'];
  }
  available(model) {
    return this.profiles[model]?.status === 'available';
  }
  status() {
    return {
      provider: this.id,
      credential: this.local || !!this.secrets?.status?.().nvidia,
      budget: this.local ? null : this.budget.snapshot(),
      models: (this.local
        ? [{ id: this.config().nimModel, role: 'spatial', free: true }]
        : catalog
      ).map((m) => ({
        ...m,
        ...this.profiles[m.id],
        caps: this.profiles[m.id]?.caps || [],
        status: this.profiles[m.id]?.status || 'unverified',
      })),
    };
  }
  async models(signal) {
    try {
      if (this.local && !this.config().nimEnabled) return { online: false, models: [] };
      const data = await json(
        await this.request(this.base() + '/models', null, this.headers(), signal),
      );
      const models = (data.data || []).map((m) => m.id).filter((m) => typeof m === 'string');
      return { online: true, models };
    } catch {
      signal?.throwIfAborted();
      return { online: false, models: [] };
    }
  }
  async rateLimited(response, model) {
    const retry = response.headers.get('retry-after');
    const seconds = /^\d+$/.test(retry || '')
      ? Number(retry)
      : Math.max(0, (Date.parse(retry || '') - Date.now()) / 1000);
    this.modelCooldowns ||= new Map();
    this.modelCooldowns.set(
      model,
      Date.now() +
        Math.max(1000, Math.min(3600000, Number.isFinite(seconds) ? seconds * 1000 : 60000)),
    );
    // Exposed status remains useful, while enforcement is per model.
    this.cooldownUntil = Math.max(...this.modelCooldowns.values());
  }
  async chat(messages, tools, vision, signal, onDelta, options = {}) {
    const c = this.config(),
      model =
        options.model || (this.local ? c.nimModel : vision ? c.nvidiaVisionModel : c.nvidiaModel);
    if ((this.modelCooldowns?.get(model) || 0) > Date.now()) throw new ProviderError('http_429');
    if (!/^[\w.-]+\/[\w.-]+$/.test(model || '')) throw new ProviderError('missing_model', false);
    if (this.local && !c.nimEnabled) throw new ProviderError('nim_disabled', false);
    if (!this.local && (!c.nvidiaFreeEndpoint || !catalog.find((m) => m.id === model)?.free))
      throw new ProviderError('free_endpoint_unverified', false);
    const metadata = catalog.find((m) => m.id === model),
      max = Math.max(
        metadata?.reasoning === 'effort' ? (vision ? 4096 : 1024) : 256,
        Math.min(8192, options.outputTokens || 2048),
      );
    const stream =
      options.stream ??
      (!this.profiles[model]?.preferNonstream &&
        (!!onDelta || this.profiles[model]?.streamOnly === true));
    // Large union grammars are rejected by some hosted implementations. Use
    // JSON mode for those contracts and keep validation in the host tool schema.
    const contract = options.schema && JSON.stringify(options.schema);
    const promptSchema = options.promptSchema || this.profiles[model]?.schemaMode === 'prompt';
    const complexTools = tools?.some((t) => JSON.stringify(t.function.parameters).length > 5000);
    // Large unions can fail NIM grammar compilation with HTTP 500. Send the
    // compact grammar up front; the complete host contract still validates calls.
    const compactTools = complexTools || options.compactTools;
    const adaptedTools = compactTools
      ? tools.map((t) => ({
          ...t,
          function: { ...t.function, parameters: compactContract(t.function.parameters) },
        }))
      : tools;
    const jsonObject =
      options.jsonObject ||
      (contract &&
        (contract.length > 5000 || contract.includes('"anyOf"') || contract.includes('"oneOf"')));
    const body = {
      model,
      messages: input(
        (() => {
          const prepared =
            (jsonObject || promptSchema) && contract
              ? [
                  {
                    role: 'system',
                    content: 'Return only a JSON object satisfying this contract: ' + contract,
                  },
                  ...messages,
                ]
              : messages;
          return compactTools
            ? [
                {
                  role: 'system',
                  content:
                    'Tool argument contracts are enforced by the host. Return actual argument VALUES matching these complete contracts, never their JSON schemas: ' +
                    JSON.stringify(
                      tools.map((t) => ({
                        name: t.function.name,
                        parameters: t.function.parameters,
                      })),
                    ),
                },
                ...prepared,
              ]
            : prepared;
        })(),
      ),
      max_tokens: max,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(adaptedTools?.length
        ? { tools: adaptedTools, tool_choice: options.forceTool || 'auto' }
        : {}),
      ...(options.schema && !promptSchema
        ? {
            response_format: jsonObject
              ? { type: 'json_object' }
              : {
                  type: 'json_schema',
                  json_schema: { name: 'jarvis_result', schema: options.schema, strict: true },
                },
          }
        : {}),
      ...(metadata?.reasoning === 'effort'
        ? {
            reasoning_effort:
              this.profiles[model]?.reasoningMode || (options.reasoning ? 'max' : 'low'),
          }
        : {}),
      ...(['template', 'budget'].includes(metadata?.reasoning)
        ? {
            chat_template_kwargs: { enable_thinking: !!options.reasoning },
            ...(metadata.reasoning === 'budget' && options.reasoning
              ? { reasoning_budget: Math.floor(Math.min(1024, max / 4)) }
              : {}),
          }
        : {}),
    };
    const headers = this.headers();
    if (!this.local)
      await (this.budget.reserve ? this.budget.reserve(signal) : this.budget.take(signal));
    let response;
    try {
      response = await this.request(
        this.base() + '/chat/completions',
        body,
        headers,
        signal,
        options,
      );
    } catch (error) {
      if (complexTools && !compactTools && error.code === 'http_500') {
        trace(this, 'adapter-recovery', {
          model,
          code: error.code,
          from: 'complex-tool-schema',
          to: 'compact-tool-schema-with-host-validation',
        });
        const reply = await this.chat(messages, tools, vision, signal, onDelta, {
          ...options,
          compactTools: true,
        });
        if (this.profiles[model]) {
          this.profiles[model].toolSchemaMode = 'compact';
          this.saveProfiles();
        }
        return reply;
      }
      // NIM can return 500 from its own constrained-output parser. Change the
      // rejected format on the SAME model once; keep the host contract and
      // validation, and never resend that failing grammar to every fallback.
      if (
        body.response_format &&
        error.code === 'http_500' &&
        /parse chat completion response/i.test(error.diagnostic?.error || '')
      ) {
        trace(this, 'adapter-recovery', {
          model,
          code: error.code,
          from: 'constrained-json',
          to: 'streamed-prompt-json',
        });
        const reply = await this.chat(messages, tools, vision, signal, onDelta, {
          ...options,
          promptSchema: true,
          stream: true,
        });
        if (options.schema) {
          try {
            JSON.parse(reply.content);
          } catch {
            throw new ProviderError('malformed_response');
          }
        }
        if (this.profiles[model]) {
          this.profiles[model].schemaMode = 'prompt';
          this.saveProfiles();
        }
        return reply;
      }
      throw error;
    }
    if (!stream) {
      let reply;
      try {
        reply = normalize(await json(response));
      } catch (error) {
        if (
          vision &&
          options.schema &&
          error.code === 'empty_response' &&
          !options.transportRecovery
        ) {
          trace(this, 'adapter-recovery', {
            model,
            code: error.code,
            from: 'empty-constrained-nonstream',
            to: 'streamed-prompt-json',
          });
          return this.chat(messages, tools, vision, signal, onDelta, {
            ...options,
            stream: true,
            promptSchema: true,
            transportRecovery: true,
          });
        }
        throw error;
      }
      if (onDelta && reply.content) onDelta(reply.content);
      return reply;
    }
    const filter = new ReasoningFilter(),
      toolMap = new Map();
    let content = '',
      finish,
      usage = {},
      reasoning = '';
    await sse(
      response,
      (event) => {
        if (event.usage) usage = event.usage;
        const choice = event.choices?.[0];
        if (!choice) return;
        const delta = choice.delta || {};
        reasoning += delta.reasoning_content || '';
        if (delta.content) {
          content += delta.content;
          const visible = filter.push(delta.content);
          if (visible) onDelta?.(visible);
        }
        for (const t of delta.tool_calls || []) {
          if (!Number.isInteger(t.index) || t.index < 0 || t.index > 31)
            throw new ProviderError('malformed_tool_call');
          const current = toolMap.get(t.index) || {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
          if (t.id) current.id = t.id;
          current.function.name += t.function?.name || '';
          current.function.arguments += t.function?.arguments || '';
          toolMap.set(t.index, current);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      },
      signal,
    );
    const last = filter.push('', true);
    trace(this, 'stream-parsed', {
      ...responseMetadata.get(response)?.diagnostic,
      finish,
      contentLength: content.length,
      reasoningLength: reasoning.length,
      toolCount: toolMap.size,
    });
    if (last) onDelta?.(last);
    if (!finish) throw new ProviderError('stream_interrupted');
    if (!clean(content) && !toolMap.size && finish === 'stop' && !options.transportRecovery) {
      trace(this, 'adapter-recovery', {
        model,
        code: 'empty_response',
        from: 'empty-stream',
        to: 'nonstream',
      });
      const reply = await this.chat(messages, tools, vision, signal, onDelta, {
        ...options,
        stream: false,
        transportRecovery: true,
      });
      if (this.profiles[model]) {
        this.profiles[model].preferNonstream = true;
        this.profiles[model].streamOnly = false;
        this.saveProfiles();
      }
      return reply;
    }
    return normalize({
      choices: [
        {
          finish_reason: finish,
          message: {
            role: 'assistant',
            content,
            tool_calls: [...toolMap.values()],
            ...(reasoning ? { reasoning_content: reasoning } : {}),
          },
        },
      ],
      usage,
    });
  }
  async probe(model, signal) {
    const caps = ['TEXT'];
    const state = {
      caps: [],
      testedAt: Date.now(),
      status: 'unavailable',
      streamOnly: this.profiles[model]?.streamOnly === true,
      reasoningMode: this.profiles[model]?.reasoningMode,
    };
    try {
      let response;
      try {
        response = await this.chat(
          [{ role: 'user', content: 'Say READY only.' }],
          undefined,
          false,
          signal,
          undefined,
          { model, outputTokens: 256 },
        );
      } catch (error) {
        signal?.throwIfAborted();
        if (
          catalog.find((m) => m.id === model)?.reasoning !== 'effort' ||
          !['empty_response', 'incomplete_response'].includes(error.code)
        )
          throw error;
        response = await this.chat(
          [{ role: 'user', content: 'Say READY only.' }],
          undefined,
          false,
          signal,
          () => {},
          { model, outputTokens: 1024, reasoning: true },
        );
        state.streamOnly = true;
        state.reasoningMode = 'max';
        caps.push('STREAMING');
      }
      if (!response.content) throw new ProviderError('empty_response');
      state.status = 'available';
      state.caps = caps;
      this.profiles[model] = state;
      for (const feature of ['STREAMING', 'TOOLS', 'STRUCTURED_OUTPUT', 'VISION', 'REASONING']) {
        if (state.caps.includes(feature)) continue;
        signal?.throwIfAborted();
        try {
          let result;
          if (feature === 'STREAMING') {
            let streamed = '';
            result = await this.chat(
              [{ role: 'user', content: 'Say READY only.' }],
              undefined,
              false,
              signal,
              (t) => (streamed += t),
              { model, outputTokens: 256 },
            );
            if (!streamed.trim()) continue;
          } else if (feature === 'REASONING') {
            if (!metadataReasoning(model)) continue;
            result = await this.chat(
              [{ role: 'user', content: 'What is 3 plus 4? Answer with the number only.' }],
              undefined,
              false,
              signal,
              undefined,
              { model, outputTokens: 512, reasoning: true },
            );
            if (!/7/.test(result.content)) continue;
          } else if (feature === 'TOOLS') {
            const tool = {
              type: 'function',
              function: {
                name: 'probe_value',
                description: 'Read synthetic value. No real action.',
                parameters: {
                  type: 'object',
                  properties: { value: { type: 'integer' } },
                  required: ['value'],
                  additionalProperties: false,
                },
              },
            };
            result = await this.chat(
              [{ role: 'user', content: 'Call probe_value with value 7. Do not answer in text.' }],
              [tool],
              false,
              signal,
              undefined,
              {
                model,
                outputTokens: 512,
                forceTool: { type: 'function', function: { name: 'probe_value' } },
              },
            );
            if (
              result.tool_calls?.[0]?.function.name !== 'probe_value' ||
              result.tool_calls[0].function.arguments.value !== 7
            )
              continue;
          } else if (feature === 'STRUCTURED_OUTPUT') {
            result = await this.chat(
              [{ role: 'user', content: 'Return value 7.' }],
              undefined,
              false,
              signal,
              undefined,
              {
                model,
                outputTokens: 512,
                schema: {
                  type: 'object',
                  properties: { value: { type: 'integer' } },
                  required: ['value'],
                  additionalProperties: false,
                },
              },
            );
            if (JSON.parse(result.content).value !== 7) continue;
          } else {
            result = await this.chat(
              [
                {
                  role: 'user',
                  content: 'Describe the color only.',
                  images: [require('../test-image.cjs').redPng()],
                },
              ],
              undefined,
              true,
              signal,
              undefined,
              { model, outputTokens: 512 },
            );
            if (!/red/i.test(result.content)) continue;
          }
          state.caps.push(feature);
        } catch (error) {
          signal?.throwIfAborted();
          if (['http_401', 'http_403', 'http_402', 'http_429', 'daily_budget'].includes(error.code))
            break;
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      state.reason = error.code || 'unavailable';
    }
    this.profiles[model] = state;
    this.saveProfiles();
    this.emit('provider-status', this.status());
    return state;
  }
  async probeAll(signal) {
    if (!this.local && !this.secrets?.status?.().nvidia)
      throw new ProviderError('missing_key', false);
    const found = await this.models(signal);
    if (!found.online) throw new ProviderError('catalog_unavailable');
    for (const m of this.local ? [{ id: this.config().nimModel, free: true }] : catalog) {
      if (!found.models.includes(m.id) || !m.free) {
        this.profiles[m.id] = { caps: [], status: 'unavailable', testedAt: Date.now() };
        continue;
      }
      const result = await this.probe(m.id, signal);
      if (
        (!this.local && this.budget.snapshot().limited) ||
        ['http_401', 'http_403', 'http_402', 'http_429'].includes(result.reason) ||
        this.cooldownUntil > Date.now()
      )
        break;
    }
    this.saveProfiles();
    return this.status();
  }
}
function metadataReasoning(model) {
  return ['budget', 'template', 'effort'].includes(catalog.find((m) => m.id === model)?.reasoning);
}
module.exports = { NvidiaProvider, input, normalize, clean, ReasoningFilter, compactContract };

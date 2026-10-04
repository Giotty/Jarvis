const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const metadata = new WeakMap();
function category(code) {
  if (/^(http_40[13]|missing_key)$/.test(code)) return 'AUTH_ERROR';
  if (/^(http_404|missing_model)$/.test(code)) return 'MODEL_NOT_FOUND';
  if (/budget_storage|budget_busy/.test(code)) return 'SERVER_ERROR';
  if (/429|budget|session_limit/.test(code)) return 'RATE_LIMIT';
  if (/timeout/.test(code)) return 'TIMEOUT';
  if (/unsupported_parameter/.test(code)) return 'UNSUPPORTED_PARAMETER';
  if (/vision_unsupported/.test(code)) return 'VISION_NOT_SUPPORTED';
  if (/tools_unsupported/.test(code)) return 'TOOLS_NOT_SUPPORTED';
  if (/unsupported|no_provider|free_endpoint|disabled/.test(code))
    return 'ROUTER_CAPABILITY_MISMATCH';
  if (/http_400|http_422/.test(code)) return 'BAD_REQUEST';
  if (/stream/.test(code)) return 'STREAM_PARSE_ERROR';
  if (/response|tool_call/.test(code)) return 'MALFORMED_RESPONSE';
  if (/network/.test(code)) return 'NETWORK_OFFLINE';
  return 'SERVER_ERROR';
}
function safeError(value) {
  return String(value || '')
    .replace(/(?:Bearer\s+)?(?:nvapi-[\w-]+|AIza[\w-]+|sk-[\w-]+|AQ\.[\w-]+)/gi, '[REDACTED]')
    .replace(/https?:\/\/\S+/g, '[URL]')
    .replace(/[A-Z]:\\[^\s"]+/gi, '[PATH]')
    .slice(0, 500);
}
function trace(provider, event, fields = {}) {
  const entry = { time: new Date().toISOString(), event, provider: provider.id, ...fields };
  provider.emit?.('provider-diagnostic', entry);
  try {
    if (provider.file) {
      const file = path.join(path.dirname(provider.file), 'logs', 'providers.jsonl');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 4e6) {
        if (fs.existsSync(file + '.1')) fs.unlinkSync(file + '.1');
        fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    }
  } catch {
    /* Diagnostics must never turn a successful response into a failure. */
  }
  return entry;
}
function requestTrace(provider, url, body) {
  return {
    id: crypto.randomUUID(),
    model: body?.model,
    endpoint: url.split('?')[0],
    requestType: body?.stream ? 'stream' : body ? 'nonstream' : 'models',
    parameters: body ? Object.keys(body) : [],
    tools: body?.tools?.length || 0,
    toolSchemaBytes: body?.tools
      ? JSON.stringify(
          body.tools.map((t) => t.function?.parameters ?? t.input_schema ?? t.functionDeclarations),
        ).length
      : 0,
    images:
      body?.messages?.reduce(
        (n, m) =>
          n +
          (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').length : 0),
        0,
      ) || 0,
    maxTokens: body?.max_tokens,
  };
}
module.exports = { category, safeError, trace, requestTrace, metadata };

function publicError(error) {
  const categories = {
    AUTH_ERROR: 'The AI credential was rejected. Check the saved key in Settings.',
    MODEL_NOT_FOUND: 'The selected AI model is unavailable at its configured endpoint.',
    RATE_LIMIT: 'The provider request limit was reached. A compatible fallback will be used.',
    BAD_REQUEST: 'The AI provider rejected the request format.',
    UNSUPPORTED_PARAMETER: 'The AI provider rejected an unsupported parameter.',
    VISION_NOT_SUPPORTED: 'The selected model cannot process images.',
    TOOLS_NOT_SUPPORTED: 'The selected model cannot call tools.',
    STREAM_PARSE_ERROR: 'The AI response stream could not be read.',
    MALFORMED_RESPONSE: 'The AI provider returned an incomplete or invalid response.',
    ROUTER_CAPABILITY_MISMATCH:
      'No configured model supports the capabilities required for this step.',
    SERVER_ERROR: 'The AI provider reported a server error.',
  };
  if (categories[error?.category]) return categories[error.category];
  const message = String(error?.message || error || '');
  if (error?.name === 'TimeoutError' || /timed out|timeout|too long/i.test(message))
    return 'That took too long. The local model or service may be busy; you can try again or choose another provider.';
  if (/repeated action failures/i.test(message))
    return 'I couldn’t complete that reliably. I stopped after three unsuccessful attempts; bring the target window forward or give me a clearer target.';
  if (/AI provider|missing_key|missing_model/i.test(message))
    return 'AI connection unavailable. Check the provider, model and saved key in Settings, or select Ollama.';
  if (/step limit/i.test(message))
    return 'I reached the task limit. Please check the result before continuing.';
  if (error?.issues?.some((issue) => issue.path?.includes('query')))
    return 'I wasn’t sure what you wanted me to search for.';
  if (/combat/i.test(message))
    return 'I can help with visible game information and menus, but I won’t automate combat.';
  if (
    error?.issues ||
    /Zod|too_small|invalid_type|Invalid.*response|JSON|Unexpected token|schema/i.test(message)
  )
    return 'I couldn’t understand that step. I’ll need a clearer target or search phrase.';
  if (/denied|expired|stopped|cancelled|aborted/i.test(message))
    return 'That action was cancelled or needs fresh approval.';
  if (/microphone|device not found|NotFoundError|NotReadableError/i.test(message))
    return 'Microphone unavailable. Check the selected device in Settings.';
  if (/permission|disabled|access.*denied|off\./i.test(message))
    return 'That capability is unavailable with the current permissions. Check Settings.';
  if (/confident|unique|target.*changed|foreground.*changed|outside.*window/i.test(message))
    return 'I couldn’t identify a stable target. Bring the intended window forward and try again.';
  if (/Ollama|model|timeout|timed out|fetch|network/i.test(message))
    return 'That took too long or the local service was unavailable. Please try again.';
  return 'That step didn’t work. I can try another approach or you can give me a clearer target.';
}
function failure(error, code = 'tool_failed', retryable = true) {
  return {
    success: false,
    verified: false,
    error: code,
    details: publicError(error),
    retryable,
    observed_result: null,
    message: publicError(error),
  };
}
function result(value = {}) {
  if (value == null) value = {};
  if (Array.isArray(value)) value = { observed_result: value };
  if (typeof value !== 'object') value = { observed_result: value };
  if (value.success === false || value.error)
    return { verified: false, retryable: false, observed_result: null, ...value };
  const verified = value.verified === true;
  return {
    success: true,
    error: null,
    details: null,
    retryable: false,
    observed_result: value.observed_result || null,
    ...value,
    verified,
  };
}
module.exports = { publicError, failure, result };

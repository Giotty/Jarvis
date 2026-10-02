const { publicError } = require('../agent-errors.cjs');
function safeResponse(content, steps) {
  const searches = steps.filter((s) => s.tool === 'search_files' && s.result?.success);
  if (
    searches.length &&
    steps.every((s) => s.tool === 'search_files') &&
    searches.every((s) => !s.result.matches?.length)
  ) {
    const latest = searches.at(-1).result;
    return latest.complete
      ? 'No matching files or folders were found in the accessible locations searched.'
      : `No additional matching files or folders were found in this portion of the scan (${latest.scannedEntries || 0} entries checked). The search is incomplete and can continue from its saved position.`;
  }
  const failed = steps.find(
    (step, index) =>
      step.risk > 0 &&
      step.result?.success === false &&
      !steps.slice(index + 1).some((later) => later.tool === step.tool && later.result?.verified),
  );
  if (
    failed &&
    /\b(?:done|all set|opened|launched|clicked|sent|saved|deleted|completed|is open)\b/i.test(
      content || '',
    )
  )
    return failed.result.message || 'I couldn’t verify the full request because a step failed.';
  if (
    /ZodError|too_small|invalid_type|Traceback|"issues"\s*:|HTTP \d{3}|\bat [\w.]+ \(/i.test(
      content || '',
    )
  )
    return publicError(Error('Invalid model response'));
  const unresolved = steps.filter((s) => s.status === 'done' && s.risk > 0 && !s.result?.verified);
  if (
    unresolved.length &&
    /\b(?:done|opened|launched|clicked|sent|saved|deleted|completed|is open)\b/i.test(content || '')
  )
    return 'I attempted that, but couldn’t verify the result yet.';
  if (
    !steps.some((s) => s.risk > 0 && s.result?.verified) &&
    /\b(?:I (?:have |successfully )?(?:opened|launched|clicked|sent|deleted|saved)|(?:YouTube|Steam|Roblox) is (?:already )?open)\b/i.test(
      content || '',
    )
  )
    return 'I haven’t verified that action yet.';
  return content?.trim() || 'I couldn’t complete that request. Please give me a clearer target.';
}
function capabilityCorrection(content, steps, tools, config, request = '') {
  const available = new Set(tools.map((t) => t.function.name));
  if (
    config.filesystem &&
    available.has('search_files') &&
    !steps.some((s) => ['search_files', 'list_directory', 'read_file'].includes(s.tool)) &&
    /(?:\b(?:cannot|can't|unable to|do not|don't|no)\b.{0,65}\b(?:access|search|browse)\b.{0,65}\b(?:files|folders|filesystem|file system|drives|computer)|\bno access\b.{0,60}\b(?:files|folders|computer))/i.test(
      content || '',
    )
  )
    return 'Filesystem access is enabled. search_files is available and defaults to every accessible local drive. Try the tool before denying access; it reports actual scope and permission failures.';
  if (
    available.has('web_search') &&
    !steps.some((s) => ['web_search', 'get_weather', 'extract_page_text'].includes(s.tool)) &&
    /\b(?:cannot|can't|unable to|do not|don't|no)\b.{0,65}\b(?:browse|search|access|retrieve)\b.{0,65}\b(?:internet|web|weather|online|current|real.time)/i.test(
      content || '',
    )
  )
    return 'Background web_search and get_weather are available. Fetch sources yourself and answer directly; do not deny online access without trying these tools.';
  if (
    available.has('web_search') &&
    !steps.some((s) =>
      ['web_search', 'get_weather', 'extract_page_text', 'summarize_page'].includes(s.tool),
    ) &&
    !steps.some((s) => s.risk > 0) &&
    /\b(?:current|latest|today|recent|newest|news|updates|right now)\b/i.test(request) &&
    /\b(?:what|which|how|tell|give|show|find|is|are)\b/i.test(request) &&
    !/\?\s*$/.test(content || '')
  )
    return 'This request asks for current information. Your answer has no fresh source evidence. Use background web_search (or get_weather) before answering; retrieve actual publication/quote dates and cite the source. Do not send the user to their browser.';
  return null;
}
module.exports = { safeResponse, capabilityCorrection };

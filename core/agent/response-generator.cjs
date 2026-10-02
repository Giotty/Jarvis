const { publicError } = require('../agent-errors.cjs');
function safeResponse(content, steps) {
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
module.exports = { safeResponse };

// Shared by renderer playback and the host immediately before neural synthesis.
export function sanitizeSpeech(input) {
  let text = String(input || '').slice(0, 12000);
  if (/^\s*(?:\{\s*["']|\[\s*\{)/.test(text)) return '';
  try {
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      JSON.parse(text);
      return '';
    }
  } catch {
    /* Ordinary prose is not a JSON document. */
  }
  return (
    text
      .replace(/```[\s\S]*?(?:```|$)/g, ' ')
      .replace(/<(script|style)[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*(?:>|$)/g, ' ')
      .replace(/(?:https?:\/\/|www\.|mailto:)[^\s<>]+/gi, ' ')
      .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|edu|gov|io|ca|co|uk|ai)(?:\/[^\s]*)?/gi, ' ')
      .replace(/\[[^\]]*(?:source|citation|turn\d|\d)[^\]]*\]/gi, ' ')
      .replace(/\b(?:source[-_:][\w-]+|turn\d+(?:search|view|fetch)\d+)\b/gi, ' ')
      .replace(/[【〔][^】〕]*[】〕]/g, ' ')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, ' ')
      .replace(/\{[^{}]*"[^{}]*:[^{}]*\}/g, ' ')
      .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|(?:\u200d|\ufe0f|\u20e3)/gu, '')
      .replace(/&amp;/gi, ' and ')
      .replace(/&(?:nbsp|lt|gt|quot|apos);|&#\d+;/gi, ' ')
      .replace(/^\s*(?:#{1,6}|>+|[-*+]\s|\d+[.)]\s)/gm, '')
      .replace(/[*_~`]+/g, '')
      .replace(/[{}[\]<>|\\^#]/g, ' ')
      .replace(/([!?.,;:])\1+/g, '$1')
      // eslint-disable-next-line no-control-regex -- remove non-speech control bytes
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const { cleanTranscript, rankNames } = require('./app-matching.cjs');
function screenRelated(text) {
  return /\b(?:screen|window|visible|button|profile|error|this|that|it|there|first|second|right|left|looking at|game|boss|menu|stuck|not working|where.*click|go back|scroll|fill|type|textbox|search box)\b/i.test(
    text,
  );
}
function actionable(text) {
  return /\b(?:open|launch|start|click|select|choose|press|tap|scroll|type|write|fill|close|switch|focus|minimize|maximize|move|copy|rename|delete|create|save|run|execute|install|uninstall|search|find|look up|research|check|play|pause|turn|mute|fix|help|try again|another way|remember|using (?:ram|memory|cpu)|computer|pc)\b/i.test(
    text,
  );
}
async function fastIntent(input, config, apps, context) {
  const text = cleanTranscript(input)
    .replace(/[.!?]+$/, '')
    .replace(/\s+please$/i, '');
  // A narrow shortcut for a single registered destination. All contextual,
  // screen-relative and multi-step tasks go through the general planner.
  const match = /^(?:open|launch|start|go to)\s+(?:the\s+)?(.+)$/i.exec(text);
  if (
    !match ||
    /\b(?:and|then|in|on|my|this|that|it|first|second|profile|button|file|folder|right|left)\b/i.test(
      match[1],
    )
  )
    return null;
  const query = match[1].replace(/\s+(?:app|application|launcher)$/i, '');
  if (/^https?:\/\//i.test(query)) return { tool: 'open_url', args: { url: query } };
  const aliases = config.websiteAliases || {};
  const ranked = rankNames(
    query,
    Object.keys(aliases),
    JSON.stringify(context?.recentActions?.slice(-2) || []),
  );
  if (ranked[0]?.confidence >= 0.85 && ranked[0].confidence - (ranked[1]?.confidence || 0) >= 0.1)
    return { tool: 'open_url', args: { url: aliases[ranked[0].name] } };
  const all = await apps.all();
  const name = config.appAliases?.[query.toLowerCase()] || query;
  const { chooseApp } = require('./windows-system.cjs');
  const selected = chooseApp(name, all, JSON.stringify(context)).selected;
  if (selected) return { tool: 'open_application', args: { name: selected.Name } };
  return null;
}
function namedWindow(text, windows = []) {
  const ignored = new Set([
    'open',
    'please',
    'jarvis',
    'first',
    'second',
    'profile',
    'screen',
    'window',
    'click',
    'search',
    'button',
    'application',
    'inside',
    'this',
    'that',
    'steamwebhelper',
  ]);
  const words =
    cleanTranscript(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  const relevant = words.filter((word) => word.length >= 4 && !ignored.has(word));
  const matches = windows.filter(
    (window) =>
      window.application !== 'jarvis.exe' &&
      relevant.some((word) => {
        const titleWords = (window.title || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        return (
          titleWords.includes(word) ||
          (window.application || '').replace(/\.exe$/i, '').toLowerCase() === word
        );
      }),
  );
  return matches.length === 1 ? matches[0] : null;
}
module.exports = { screenRelated, actionable, fastIntent, cleanTranscript, namedWindow };

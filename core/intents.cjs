function directIntent(input, context = {}) {
  const text = input
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:hey\s+)?jarvis[, :]+/i, '')
    .replace(/^(?:can|could|would) you\s+/i, '')
    .replace(/^please\s+/i, '')
    .replace(/\s+please$/i, '');
  // Leave multi-step requests to the planner rather than treating later actions
  // as part of a search query and silently dropping them.
  if (
    /\b(?:and then|then|and)\s+(?:open|play|watch|click|send|delete|type|subscribe|go)\b/i.test(
      text,
    )
  )
    return null;
  const action = (tool, args) => ({ tool, args });
  let match = text.match(
    /^(?:open|go to|launch)\s+(youtube|google|roblox)\s+(?:and\s+)?(?:search(?:\s+for)?|look\s+for|find)\s+(.+)$/i,
  );
  if (match) return action('search_web', { site: match[1].toLowerCase(), query: match[2] });
  match = text.match(
    /^(?:search(?:\s+for)?|find|look\s+for)\s+(.+?)\s+on\s+(youtube|google|roblox)$/i,
  );
  if (match) return action('search_web', { site: match[2].toLowerCase(), query: match[1] });
  match = text.match(/^(?:search|find)\s+(?:on\s+)?(youtube|google|roblox)\s+(?:for\s+)?(.+)$/i);
  if (match) return action('search_web', { site: match[1].toLowerCase(), query: match[2] });
  if (/^(?:open|play|launch|start)\s+(?:a|any|some|the)\s+game\s+(?:in|on)\s+roblox$/i.test(text))
    return { reply: 'Which Roblox game would you like to play? Tell me its name.' };
  match = text.match(
    /^(?:play|open|launch|start)\s+(?:the\s+game\s+)?(.+?)\s+(?:in|on)\s+roblox$/i,
  );
  if (match) return action('play_roblox_game', { query: match[1] });
  match = text.match(/^(?:play|open|launch|start)\s+roblox\s+(?:game\s+)?(.+)$/i);
  if (match) return action('play_roblox_game', { query: match[1] });
  const numbers = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
  match = text.match(
    /^(?:(?:open|play|choose)\s+)?(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+(?:one|game))?$/i,
  );
  if (match && context.games?.[numbers[match[1].toLowerCase()]])
    return action('launch_roblox_game', {
      placeId: context.games[numbers[match[1].toLowerCase()]].placeId,
    });
  match = text.match(/^(?:search(?:\s+for)?|find|look\s+for)\s+(.+)$/i);
  if (match && context.site) return action('search_web', { site: context.site, query: match[1] });
  match = text.match(/^(?:open|go to)\s+(youtube|google)$/i);
  if (match) return action('open_url', { url: `https://www.${match[1].toLowerCase()}.com/` });
  match = text.match(
    /^(?:open|launch|start)\s+(?:the\s+)?(roblox|notepad|calculator|file explorer|explorer|spotify|google chrome|chrome|microsoft edge|edge)(?:\s+app)?$/i,
  );
  if (match) {
    const aliases = {
      'file explorer': 'explorer',
      'google chrome': 'chrome',
      'microsoft edge': 'edge',
    };
    return action('open_application', {
      name: aliases[match[1].toLowerCase()] || match[1].toLowerCase(),
    });
  }
  return null;
}
module.exports = { directIntent };

// Historical regression fixture only. Never loaded or packaged by JARVIS.
function screenRequest(text) {
  if (/\b(?:don't|do not|never)\b.*\b(?:click|select|choose|press|tap|open)\b/i.test(text))
    return null;
  const act = /\b(?:click(?:\s+on)?|select|choose|press|tap|open)\s+(.+)/i.exec(text);
  const target = act?.[1];
  if (
    target &&
    /\b(?:and then|then|and)\s+(?:open|click|select|choose|press|send|delete|type)\b/i.test(target)
  )
    return { click: false };
  if (
    target &&
    (/\b(?:click|select|choose|press|tap)\b/i.test(act[0]) ||
      /\b(?:profiles?|accounts?|buttons?|icons?|tiles?|links?|tabs?|items?|avatars?|first|second|third|leftmost|rightmost)\b/i.test(
        target,
      ))
  )
    return {
      click: true,
      label: target
        .replace(/[.!?]+$/, '')
        .trim()
        .slice(0, 200),
    };
  if (
    /\b(?:look at|see|show|describe|what.*(?:on|in))\b.*\b(?:screen|window|page|app|launcher|profiles?|steam)\b/i.test(
      text,
    )
  )
    return { click: false };
  if (/\b(?:what (?:can|do) you see|look at this|look at my screen)\b/i.test(text))
    return { click: false };
  return null;
}
function directIntent(input, context = {}) {
  const text = input
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:okay|ok|alright)[, :]+/i, '')
    .replace(/^(?:hey\s+)?jarvis[, :]+/i, '')
    .replace(/^(?:can|could|would) you\s+/i, '')
    .replace(/^please\s+/i, '')
    .replace(/\s+please$/i, '');
  // Screen-relative targets are not installed application names. Even a compound
  // request such as "look at Steam and open the first profile" must see the UI.
  const screen = screenRequest(text);
  if (screen?.click && !/\b(?:video|youtube)\b/i.test(screen.label))
    return { tool: 'click_visible_target', args: { label: screen.label } };
  // Leave multi-step requests to the planner rather than treating later actions
  // as part of a search query and silently dropping them.
  if (
    /\b(?:and then|then|and)\s+(?:open|play|watch|click|send|delete|type|subscribe|go)\b/i.test(
      text,
    )
  )
    return null;
  const action = (tool, args) => ({ tool, args });
  const ordinals = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
  ];
  const video = text.match(
    /^(?:click(?:\s+on)?|open|play|watch)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|[1-9]|10)\s+(?:youtube\s+)?(?:video|video result)(?:\s+(?:on|in)\s+(?:the\s+)?(?:page|youtube|results|search results))?$/i,
  );
  if (video)
    return action('open_youtube_result', {
      index: ordinals.includes(video[1].toLowerCase())
        ? ordinals.indexOf(video[1].toLowerCase()) + 1
        : Number(video[1]),
    });
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
  match = text.match(
    /^(?:open|launch|start)\s+(?:the\s+)?(steam|epic games?(?: launcher)?)(?:\s+app)?$/i,
  );
  if (match)
    return action('open_application', {
      name: /^steam$/i.test(match[1]) ? 'Steam' : 'Epic Games Launcher',
    });
  match = text.match(
    /^(?:open|show|go to)\s+(?:windows\s+)?settings(?:\s+(?:for|to|on)\s+(.+))?$/i,
  );
  if (match) return action('open_settings', { page: match[1] || '' });
  match = text.match(/^(?:open|show)\s+(?:the\s+)?(?:windows\s+)?(.+?)\s+settings$/i);
  if (match) return action('open_settings', { page: match[1] });
  match = text.match(
    /^(?:open|show)\s+(?:my\s+)?(downloads|documents|desktop|pictures|videos|music)(?:\s+folder)?$/i,
  );
  if (match) return action('open_file', { path: match[1] });
  match = text.match(/^(?:open|launch)\s+["']?([a-z]:[\\/].+?)["']?$/i);
  if (match)
    return action(
      /\.(exe|msi|msix|bat|cmd|ps1|vbs|js|lnk|scr|com)$/i.test(match[1])
        ? 'launch_executable'
        : 'open_file',
      { path: match[1] },
    );
  match = text.match(/^(?:open|launch|start)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i);
  if (
    match &&
    !screen &&
    !/\b(?:file|folder|game|called|named|in|on|with|and|search)\b/i.test(match[1])
  )
    return action('open_application', { name: match[1] });
  return null;
}
function conversationOnly(text) {
  if (
    /\b(?:screen|window|file|folder|computer|installed|clipboard|settings|system|apps?|application|drives?|volume|open|launch|search|find|browse|click|type|scroll|delete|move|save|run|execute|shutdown|restart|install|uninstall|registry|weather|news|time|date|roblox|youtube|remember)\b/i.test(
      text,
    )
  )
    return false;
  return /^(?:(?:hey\s+)?jarvis[, :]+)?(?:hello|hi|hey|good (?:morning|evening)|how are you|what|why|who|when|how|explain|tell me|thank|thanks|let['’]s talk)\b/i.test(
    text.trim(),
  );
}
function earlyIntent(text) {
  // Partial transcripts may change. Only reversible, named navigation starts
  // early; queries, clicks, games and destructive actions wait for the full turn.
  if (/\b(?:don't|do not|not|never|unless|wait|actually|instead)\b/i.test(text)) return null;
  const match = text
    .trim()
    .replace(/^(?:hey\s+)?jarvis[, :]+/i, '')
    .replace(/[.!?,]+$/, '')
    .match(
      /^(?:please\s+)?(?:open|go to|launch)\s+(youtube|google|notepad|calculator|chrome|edge)(?:\s+and\s+(?:search|find|look)\b.*)?$/i,
    );
  return match ? directIntent('open ' + match[1]) : null;
}
module.exports = { directIntent, earlyIntent, conversationOnly, screenRequest };

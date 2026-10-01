const crypto = require('node:crypto');
function searchUrl(site, query) {
  const urls = {
    youtube: ['https://www.youtube.com/results', 'search_query'],
    google: ['https://www.google.com/search', 'q'],
    roblox: ['https://www.roblox.com/discover/', 'Keyword'],
  };
  if (!urls[site]) throw Error('Unsupported search site.');
  const [base, key] = urls[site];
  const url = new URL(base);
  url.searchParams.set(key, query);
  return url.href;
}
async function findRobloxGames(query) {
  const url = new URL('https://apis.roblox.com/search-api/omni-search');
  url.searchParams.set('searchQuery', query);
  url.searchParams.set('sessionId', crypto.randomUUID());
  url.searchParams.set('vertical', 'games');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw Error(`Roblox game search returned ${response.status}.`);
  const data = await response.json();
  const games = (data.searchResults || []).flatMap((group) => group.contents || []);
  const ids = new Set();
  return games
    .filter((g) => Number.isSafeInteger(g.rootPlaceId) && g.rootPlaceId > 0 && !g.isSponsored)
    .filter((g) => {
      if (ids.has(g.rootPlaceId)) return false;
      ids.add(g.rootPlaceId);
      return true;
    })
    .slice(0, 5)
    .map((g) => ({
      name: g.name,
      placeId: g.rootPlaceId,
      creator: g.creatorName,
      verifiedCreator: Boolean(g.creatorHasVerifiedBadge),
      players: g.playerCount,
      url: `https://www.roblox.com/games/${g.rootPlaceId}`,
    }));
}
function gameTitle(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function chooseGame(query, games) {
  const title = gameTitle(query);
  const exact = games.filter((g) => gameTitle(g.name) === title);
  if (exact.length === 1) return exact[0];
  const first = games[0];
  if (title.length >= 3 && first?.verifiedCreator && gameTitle(first.name).startsWith(title))
    return first;
  return null;
}
module.exports = { searchUrl, findRobloxGames, chooseGame };

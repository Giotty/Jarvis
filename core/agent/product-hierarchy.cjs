function gpuIdentity(value) {
  const m = String(value).match(
    /\b(RTX|GTX)\s*[- ]?\s*(\d{3,4})\s*(Ti\s*Super|Super\s*Ti|Ti|Super)?\b/i,
  );
  if (!m) return null;
  const suffix = (m[3] || '').toLowerCase();
  return {
    family: m[1].toUpperCase(),
    number: Number(m[2]),
    generation: m[2].slice(0, -2),
    rank: suffix.includes('ti') ? (suffix.includes('super') ? 3 : 2) : suffix ? 1 : 0,
    label:
      m[1].toUpperCase() +
      ' ' +
      m[2] +
      (suffix
        ? ' ' +
          (suffix.includes('ti') ? 'Ti' : '') +
          (suffix.includes('super') ? (suffix.includes('ti') ? ' Super' : 'Super') : '')
        : ''),
    laptop: /laptop|mobile/i.test(value),
  };
}
function adjacentGpu(identity, evidence) {
  const current = gpuIdentity(identity);
  if (!current || current.laptop) return null; // Mobile TGP tiers need explicit source reasoning.
  const candidates = new Map();
  for (const source of evidence) {
    if (source.readable !== true || !/(^|\.)nvidia\.com$/.test(new URL(source.url).hostname))
      continue;
    for (const match of (source.text || '').matchAll(
      /\b(?:RTX|GTX)\s*[- ]?\s*\d{3,4}\s*(?:Ti\s*Super|Super\s*Ti|Ti|Super)?\b/gi,
    )) {
      if (
        /^(?:\s*Laptop|\s*Mobile)/i.test(
          source.text.slice(match.index + match[0].length, match.index + match[0].length + 16),
        )
      )
        continue;
      const item = gpuIdentity(match[0]);
      if (
        item.family !== current.family ||
        item.generation !== current.generation ||
        item.number < current.number ||
        (item.number === current.number && item.rank <= current.rank)
      )
        continue;
      const prior = candidates.get(item.label) || { ...item, sourceIds: [] };
      if (!prior.sourceIds.includes(source.id)) prior.sourceIds.push(source.id);
      candidates.set(item.label, prior);
    }
  }
  return [...candidates.values()].sort((a, b) => a.number - b.number || a.rank - b.rank)[0] || null;
}
module.exports = { gpuIdentity, adjacentGpu };

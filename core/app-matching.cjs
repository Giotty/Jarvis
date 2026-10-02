const normalize = (value) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])));
    row = next;
  }
  return row[b.length];
}
function soundex(value) {
  const code = {
    b: 1,
    f: 1,
    p: 1,
    v: 1,
    c: 2,
    g: 2,
    j: 2,
    k: 2,
    q: 2,
    s: 2,
    x: 2,
    z: 2,
    d: 3,
    t: 3,
    l: 4,
    m: 5,
    n: 5,
    r: 6,
  };
  const s = value.replace(/[^a-z]/g, '');
  return (
    s[0] +
    [...s.slice(1)]
      .map((c) => code[c] || '')
      .filter((c, i, a) => c && c !== a[i - 1])
      .join('')
      .slice(0, 3)
      .padEnd(3, '0')
  );
}
function rankNames(query, names, recent = '') {
  const q = normalize(query).replace(/\s+/g, '');
  return names
    .map((name) => {
      const n = normalize(name).replace(/\s+/g, '');
      let score = q === n ? 1 : 1 - distance(q, n) / Math.max(q.length, n.length, 1);
      if (q.length >= 3 && n.startsWith(q)) score = Math.max(score, 0.87);
      if (q.length >= 4 && q.length / n.length >= 0.6) {
        let at = 0;
        for (const c of n) if (c === q[at]) at++;
        if (at === q.length) score = Math.max(score, 0.85);
      }
      if (q.length >= 4 && soundex(q) === soundex(n)) score = Math.max(score, 0.82);
      if (normalize(recent).includes(normalize(name)) && score >= 0.65 && score < 1)
        score = Math.min(0.96, score + 0.08);
      return { name, confidence: score };
    })
    .sort((a, b) => b.confidence - a.confidence);
}
function cleanTranscript(text) {
  // Separate fused command words and removable wake/filler prefixes. No blind
  // global replacements: fuzzy names are resolved against actual registries.
  return text
    .trim()
    .replace(/\b([Oo]pen|[Ll]aunch|[Ss]earch)(?=[A-Z])/g, '$1 ')
    .replace(/^(?:(?:i['’]?m|hey|okay|ok|alright)[, ]+)?jarvis\b[, :.]*/i, '')
    .replace(/^(?:can|could|would) you\s+/i, '')
    .replace(/^please\s+/i, '')
    .trim();
}
module.exports = { normalize, rankNames, cleanTranscript };

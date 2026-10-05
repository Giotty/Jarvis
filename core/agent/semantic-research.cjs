const { z } = require('zod');
const norm = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const queryPlan = z
  .object({
    entities: z.array(z.string().min(1).max(150)).max(12),
    interpretation: z.string().max(500),
    queries: z.array(z.string().min(1).max(250)).min(1).max(6),
    urls: z.array(z.string().url()).max(4),
  })
  .strict();
const assessment = z
  .object({
    entities: z.array(z.string().min(1).max(150)).min(1).max(12),
    covered: z.boolean(),
    missingFacts: z.array(z.string().max(500)).max(12),
    followupQueries: z.array(z.string().min(1).max(250)).max(4),
    facts: z
      .array(
        z
          .object({
            entity: z.string().max(150),
            label: z.string().max(80),
            value: z.string().min(1).max(350),
            sourceId: z.string().max(200),
            quote: z.string().min(1).max(1200),
          })
          .strict(),
      )
      .max(48),
  })
  .strict();
function verifyFacts(facts, sources) {
  const known = new Map(sources.map((s) => [s.id, s]));
  return facts.map((fact, index) => {
    const source = known.get(fact.sourceId);
    const text = norm(
      [
        source?.text || source?.snippet || '',
        ...(source?.tables || []).flatMap((t) => t.rows.map((r) => r.join(' | '))),
      ].join('\n'),
    );
    if (
      !source ||
      source.readable === false ||
      !text.includes(norm(fact.quote)) ||
      !norm(fact.quote).includes(norm(fact.value))
    )
      throw Error('Research fact is not supported by its exact retrieved quotation: ' + fact.label);
    return { ...fact, id: 'fact-' + index, fetchedAt: source.fetchedAt, url: source.url };
  });
}
function evidenceDigest(sources) {
  return sources.map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    fetchedAt: s.fetchedAt,
    publishedAt: s.publishedAt,
    text: (s.text || s.snippet || '').slice(0, 16000),
    tables: (s.tables || []).slice(0, 5),
  }));
}
module.exports = { queryPlan, assessment, verifyFacts, evidenceDigest, norm };

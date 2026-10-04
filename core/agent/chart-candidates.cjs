const { gpuIdentity } = require('./product-hierarchy.cjs');
const normalized = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b(nvidia|geforce|intel|amd)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
function same(label, entity) {
  if (!normalized(label)) return false;
  const a = gpuIdentity(label),
    b = gpuIdentity(entity);
  return a && b
    ? a.family === b.family && a.number === b.number && a.rank === b.rank
    : normalized(label) === normalized(entity) || normalized(entity).endsWith(normalized(label));
}
function metricRelevance(metric, goal = '') {
  if (/gaming.*power|power.*gaming/i.test(metric))
    return {
      relevance: 60,
      relevanceReason: 'Measures workload power consumption, not gaming frame rate.',
    };
  const categories = [
    [
      /fps|frame.?rate|gaming|benchmark|render.*time|throughput|latency/i,
      100,
      'Directly measures workload performance.',
    ],
    [
      /cuda.*cores|stream.*processors|^(?:cores|threads)$/i,
      85,
      'Compares a main compute specification; this is not a gaming benchmark.',
    ],
    [
      /memory bandwidth|bandwidth/i,
      80,
      'Compares data throughput relevant to demanding workloads.',
    ],
    [/vram|standard memory|memory (?:size|capacity)/i, 75, 'Compares usable memory capacity.'],
    [/boost.*clock/i, 70, 'Compares the published peak clock specification.'],
    [
      /total graphics power|board power|tgp|tdp/i,
      60,
      'Compares load power and cooling requirements.',
    ],
  ];
  if (/playback|idle|standby/i.test(metric) && !/playback|idle|standby/i.test(goal))
    return {
      relevance: 5,
      relevanceReason:
        'Secondary efficiency metric, less useful for a general performance overview.',
    };
  const selected = categories.find(([pattern]) => pattern.test(metric));
  return {
    relevance: selected?.[1] || 30,
    relevanceReason: selected?.[2] || 'Comparable values observed in the same source table.',
  };
}
function candidates(evidence, entities = [], goal = '') {
  const results = [];
  if (entities.length < 2) return results;
  for (const source of evidence)
    for (const [tableIndex, table] of (source.tables || []).entries())
      for (const axis of ['rows', 'columns']) {
        const labels =
          axis === 'rows' ? table.rows.slice(1).map((r) => r[0]) : table.rows[0].slice(1);
        const selected = entities.map((entity) => labels.find((label) => same(label, entity)));
        if (selected.some((label) => !label) || new Set(selected).size !== selected.length)
          continue;
        const metricCount = axis === 'rows' ? table.rows[0].length : table.rows.length;
        for (let metricIndex = 1; metricIndex < metricCount; metricIndex++) {
          const metric = axis === 'rows' ? table.rows[0][metricIndex] : table.rows[metricIndex][0];
          if (!metric || /price|msrp|cost|release/i.test(metric)) continue;
          const cells = selected.map((label) =>
            axis === 'rows'
              ? table.rows.find((r) => r[0] === label)?.[metricIndex]
              : table.rows[metricIndex][table.rows[0].indexOf(label)],
          );
          if (cells.some((c) => !c || !/^\d[\d,.]*(?:\s*[a-z%/-]+)?$/i.test(c))) continue;
          const units = cells.map((c) => c.replace(/^[\d,.]+/, '').trim());
          if (new Set(units).size !== 1) continue;
          results.push({
            id: source.id + ':' + tableIndex + ':' + axis + ':' + metricIndex,
            title: metric,
            ...metricRelevance(metric, goal),
            unit: units[0] || metric,
            sourceId: source.id,
            data: selected.map((label, i) => ({
              label,
              value: Number(cells[i].match(/^[\d,.]+/)[0].replaceAll(',', '')),
            })),
            selection: { sourceId: source.id, tableIndex, axis, metricIndex, labels: selected },
          });
        }
      }
  for (const candidate of results) {
    candidate.corroboratingSources = [
      ...new Set(
        results
          .filter(
            (other) =>
              other.sourceId !== candidate.sourceId &&
              (normalized(candidate.title).endsWith(normalized(other.title)) ||
                normalized(other.title).endsWith(normalized(candidate.title))) &&
              JSON.stringify(candidate.data.map((d) => d.value)) ===
                JSON.stringify(other.data.map((d) => d.value)) &&
              new URL(evidence.find((s) => s.id === other.sourceId).url).hostname !==
                new URL(evidence.find((s) => s.id === candidate.sourceId).url).hostname,
          )
          .map((c) => c.sourceId),
      ),
    ];
    candidate.crossChecked = candidate.corroboratingSources.length > 0;
  }
  return results
    .sort((a, b) => b.relevance - a.relevance || Number(b.crossChecked) - Number(a.crossChecked))
    .slice(0, 30);
}
function facts(evidence, entities = []) {
  const out = [];
  for (const source of evidence)
    for (const [tableIndex, table] of (source.tables || []).entries())
      for (const axis of ['rows', 'columns']) {
        const labels =
          axis === 'rows' ? table.rows.slice(1).map((r) => r[0]) : table.rows[0].slice(1);
        for (const [entityIndex, entity] of entities.entries()) {
          const label = labels.find((label) => same(label, entity));
          if (!label) continue;
          const count = axis === 'rows' ? table.rows[0].length : table.rows.length;
          for (let at = 1; at < count; at++) {
            const metric = axis === 'rows' ? table.rows[0][at] : table.rows[at][0];
            const value =
              axis === 'rows'
                ? table.rows.find((r) => r[0] === label)?.[at]
                : table.rows[at][table.rows[0].indexOf(label)];
            if (
              !metric ||
              !value ||
              value.length > 100 ||
              /^(?:yes|no|n\/a|varies)/i.test(value) ||
              /price|cost|release/i.test(metric)
            )
              continue;
            out.push({
              id: source.id + ':fact:' + tableIndex + ':' + axis + ':' + entityIndex + ':' + at,
              entity,
              label: metric.slice(0, 80),
              value,
              sourceId: source.id,
              priority:
                /^(?:cores|threads)$|CUDA.*cores|standard memory|total graphics power/i.test(metric)
                  ? 4
                  : /boost clock|memory capacity|refresh|resolution/i.test(metric)
                    ? 3
                    : /clock|memory|power|architecture|cache/i.test(metric)
                      ? 2
                      : 0,
            });
          }
        }
      }
  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 60)
    .map((fact, index) => ({ ...fact, id: 'f' + (index + 1) }));
}
function quotes(evidence, entities = []) {
  const out = [];
  const expected = entities
    .map(gpuIdentity)
    .filter(Boolean)
    .map((g) => g.label);
  for (const source of evidence) {
    if (source.url === 'https://jarvis.local/hardware') continue;
    for (let text of String(source.text || '').split(/(?<=[.!?])\s+|\n+/)) {
      text = text.replace(/^(?:review\.)?(?:description|headline):\s*/i, '').trim();
      if (
        text.length < 55 ||
        text.length > 290 ||
        /\||https?:|Public structured|^\w+(?:\.\w+)*:/i.test(text)
      )
        continue;
      const mentioned = [
        ...text.matchAll(
          /\b(?:RTX|GTX)\s*[- ]?\s*\d{3,4}\s*(?:Ti\s*Super|Super\s*Ti|Ti|Super)?\b/gi,
        ),
      ].map((m) => gpuIdentity(m[0]).label);
      if (expected.length && mentioned.some((label) => !expected.includes(label))) continue;
      const weakness =
        /limited|limitation|weak|drawback|slower|bottleneck|disappoint|expensive|compromise|narrow|lack|constraint|concern|insufficient|not enough|less performance|less memory|can't|cannot|does not|doesn't/i.test(
          text,
        );
      const strength =
        /efficien|performance|power|quiet|cool|fast|support|improv|advantage|compact|great|excellent/i.test(
          text,
        );
      if (!weakness && !strength) continue;
      if (out.some((quote) => quote.text === text)) continue;
      out.push({
        text,
        sourceId: source.id,
        kind: weakness ? 'limitation' : 'strength',
        priority: weakness ? 2 : 1,
      });
    }
  }
  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 60)
    .map((quote, index) => ({ ...quote, id: 'q' + (index + 1) }));
}
module.exports = { candidates, facts, quotes, same, metricRelevance };

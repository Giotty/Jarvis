const normalized = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
function same(label, entity) {
  return normalized(label) !== '' && normalized(label) === normalized(entity);
}
// Selection is semantic in TaskGraph; this generic table catalog only ranks
// lexical overlap with a requested metric, never a predefined subject hierarchy.
function metricRelevance(metric, goal = '') {
  const terms =
    String(goal)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  const words = new Set(
    String(metric)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [],
  );
  return {
    relevance: terms.filter((t) => words.has(t)).length,
    relevanceReason:
      'Comparable source-table measure; semantic selection belongs to the goal planner.',
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
          if (!metric) continue;
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
            if (!metric || !value || value.length > 100 || /^(?:yes|no|n\/a|varies)/i.test(value))
              continue;
            out.push({
              id: source.id + ':fact:' + tableIndex + ':' + axis + ':' + entityIndex + ':' + at,
              entity,
              label: metric.slice(0, 80),
              value,
              sourceId: source.id,
              priority: 0,
            });
          }
        }
      }
  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 60)
    .map((fact, index) => ({ ...fact, id: 'f' + (index + 1) }));
}
function quotes(evidence) {
  const out = [];
  for (const source of evidence)
    for (const text of String(source.text || '').split(/(?<=[.!?])\s+|\n+/)) {
      const value = text.trim();
      if (
        value.length < 40 ||
        value.length > 500 ||
        value.includes('|') ||
        out.some((q) => q.text === value)
      )
        continue;
      out.push({ id: 'q' + (out.length + 1), text: value, sourceId: source.id, kind: 'context' });
    }
  return out.slice(0, 60);
}
module.exports = { candidates, facts, quotes, same, metricRelevance };

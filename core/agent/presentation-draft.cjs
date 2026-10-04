const { z } = require('zod');
// A small planning contract keeps provider grammars independent of the full UI
// schema. Source/image ownership and chart quotations remain host-validated.
const draftSchema = z
  .object({
    title: z.string().min(1).max(120),
    cards: z
      .array(
        z
          .object({
            title: z.string().min(1).max(90),
            body: z.string().max(650),
            sourceIds: z.array(z.string()).min(1).max(4),
            facts: z
              .array(
                z
                  .object({
                    label: z.string().max(80),
                    value: z.string().max(100),
                    detail: z.string().max(160),
                  })
                  .strict(),
              )
              .max(4),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    chart: z
      .object({
        title: z.string().max(90),
        unit: z.string().max(25),
        values: z
          .array(
            z
              .object({
                label: z.string().max(60),
                value: z.number().finite(),
                sourceId: z.string(),
                quote: z.string().min(1).max(500),
              })
              .strict(),
          )
          .max(6),
        table: z
          .object({
            sourceId: z.string(),
            tableIndex: z.number().int().min(0).max(7),
            axis: z.enum(['rows', 'columns']),
            metricIndex: z.number().int().min(1).max(59),
            labels: z.array(z.string().max(250)).min(2).max(6),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const selectionDraftSchema = draftSchema
  .omit({ chart: true, cards: true })
  .extend({
    chartId: z.string().nullable(),
    cards: z
      .array(
        z
          .object({
            title: z.string().min(1).max(90),
            quoteIds: z.array(z.string()).max(2),
            sourceIds: z.array(z.string()).min(1).max(4),
            factIds: z.array(z.string()).max(4),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();
const normalized = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
function qualitativeNarration(body) {
  const sentences = String(body).split(/(?<=[.!?])\s+|\n+/);
  const retained = sentences.filter(
    (sentence) => !/\d+(?:\s*[–-]\s*\d+)?\s*(?:%|fps|games\b)/i.test(sentence),
  );
  return { text: retained.join(' ').trim(), removed: sentences.length - retained.length };
}
function makeBriefing(draft, evidence, imageIds = [], requirements = {}) {
  const { numbers, briefingSchema } = require('../briefing.cjs');
  const sources = new Map(evidence.map((s) => [s.id, s]));
  const scenes = draft.cards.map((card) => {
    if (card.sourceIds.some((id) => !sources.has(id)))
      throw Error('Card cites an unobserved source.');
    return {
      title: card.title,
      narration: card.body,
      panels: [
        {
          type: card.facts.length ? 'metrics' : 'text',
          title: card.title,
          body: card.body,
          sourceIds: card.sourceIds,
          items: card.facts,
        },
      ],
    };
  });
  if (draft.chart) {
    if (draft.chart.table) {
      const selection = draft.chart.table,
        source = sources.get(selection.sourceId),
        table = source?.tables?.[selection.tableIndex];
      if (!table) throw Error('Chart selection references an unobserved table.');
      const selected = selection.labels.map((label) => {
        const row =
          selection.axis === 'rows'
            ? table.rows.find((r) => r[0] === label)
            : table.rows[selection.metricIndex];
        const column =
          selection.axis === 'rows'
            ? selection.metricIndex
            : table.rows[0].findIndex((c) => c === label);
        const cell = row?.[column];
        if (!cell || !/^\d[\d,.]*(?:\s*[a-z%/-]+)?$/i.test(cell))
          throw Error(
            'Selected table cell is not a single comparable numeric value: ' +
              JSON.stringify(selection),
          );
        return { label, cell, row };
      });
      draft.chart.values = selected.map(({ label, cell, row }) => ({
        label,
        value: Number(cell.match(/^[\d,.]+/)[0].replaceAll(',', '')),
        sourceId: source.id,
        quote: row.join(' | '),
      }));
      const units = selected.map(({ cell }) => cell.replace(/^[\d,.]+/, '').trim());
      if (new Set(units).size !== 1) throw Error('Selected chart cells have different units.');
      const header =
        selection.axis === 'rows'
          ? table.rows[0][selection.metricIndex]
          : table.rows[selection.metricIndex][0];
      if (!header) throw Error('Selected chart column has no metric header.');
      draft.chart.title = ('Compared ' + header).slice(0, 90);
      draft.chart.unit = (units[0] || header).slice(0, 25);
      if (new Set(draft.chart.values.map((v) => v.label)).size !== draft.chart.values.length)
        throw Error('Chart requires distinct subjects.');
    }
    if (draft.chart.values.length < 2)
      throw Error('Chart has insufficient comparable source data.');
    for (const datum of draft.chart.values) {
      const source = sources.get(datum.sourceId);
      if (
        !source ||
        source.url === 'https://jarvis.local/hardware' ||
        (!normalized(source.text || source.snippet).includes(normalized(datum.quote)) &&
          !(source.tables || []).some((t) =>
            t.rows.some((r) => normalized(r.join(' | ')) === normalized(datum.quote)),
          )) ||
        !numbers(datum.quote).has(datum.value)
      )
        throw Error('Chart datum lacks its real source quotation: ' + JSON.stringify(datum));
    }
    scenes.push({
      title: draft.chart.title,
      narration:
        'This chart compares the same published metric for each subject. It is not a frame-rate benchmark.',
      panels: [
        {
          type: 'bar',
          title: draft.chart.title,
          unit: draft.chart.unit,
          sourceIds: [...new Set(draft.chart.values.map((v) => v.sourceId))].slice(0, 4),
          data: draft.chart.values.map(({ label, value }) => ({ label, value })),
        },
      ],
    });
  } else if (requirements.chart) throw Error('The requested comparison chart has no sourced data.');
  const images = evidence
    .flatMap((s) =>
      (s.images || []).filter((i) => imageIds.includes(i.id)).map((i) => ({ image: i, source: s })),
    )
    .slice(0, 3);
  if (images.length)
    scenes.push({
      title: 'Subject imagery',
      narration: 'These images come from the cited public product and review pages.',
      panels: [
        {
          type: 'images',
          title: 'Attributed product images',
          sourceIds: [...new Set(images.map((i) => i.source.id))],
          imageIds: images.map((i) => i.image.id),
        },
      ],
    });
  else if (requirements.images) throw Error('No relevant image bytes have been verified.');
  scenes.push({
    title: 'Research sources',
    narration:
      'I used the official product information and independent reviews linked on these source cards.',
    panels: [
      {
        type: 'sources',
        title: 'Evidence and provenance',
        sourceIds: evidence
          .filter((s) => s.url !== 'https://jarvis.local/hardware')
          .slice(0, 4)
          .map((s) => s.id),
      },
    ],
  });
  return briefingSchema.parse({ title: draft.title, mode: 'append', scenes });
}
module.exports = { draftSchema, selectionDraftSchema, makeBriefing, qualitativeNarration };

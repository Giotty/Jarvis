const { z } = require('zod');
const { briefingSchema } = require('../briefing.cjs');
const roles = [
  'CURRENT_ENTITY',
  'RELATED_ENTITY',
  'SUPPORTING_VISUAL',
  'COMPARISON',
  'SOURCE',
  'CONTEXT',
];
const workspacePlan = z
  .object({
    title: z.string().min(1).max(120),
    cards: z
      .array(
        z
          .object({
            key: z.string().min(1).max(60),
            entity: z.string().max(150),
            relation: z.enum(roles),
            type: z.enum([
              'entity_card',
              'text_card',
              'metric_card',
              'comparison_table',
              'timeline',
              'news_card',
              'video_card',
              'location_card',
            ]),
            title: z.string().min(1).max(90),
            factIds: z.array(z.string()).min(1).max(4),
            narration: z.string().max(700),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    charts: z
      .array(
        z
          .object({
            title: z.string().max(90),
            type: z.enum(['bar', 'line']),
            unit: z.string().max(25),
            factIds: z.array(z.string()).min(2).max(12),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
function materialize(plan, facts, sources, imageIds = []) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const choose = (ids) =>
    ids.map((id) => {
      const f = byId.get(id);
      if (!f) throw Error('Workspace selected an unobserved fact.');
      return f;
    });
  if (new Set(plan.cards.map((c) => c.key)).size !== plan.cards.length)
    throw Error('Workspace keys must be unique.');
  const scenes = plan.cards.map((card) => {
    const selected = choose(card.factIds);
    const sourceIds = [...new Set(selected.map((f) => f.sourceId))];
    const body = selected.map((f) => f.label + ': ' + f.value).join('\n');
    return {
      key: card.key,
      groupId: card.entity || card.key,
      groupTitle: (card.entity || card.title).slice(0, 90),
      relation: card.relation,
      title: card.title,
      narration: card.narration,
      segments: [
        {
          text: card.narration || body,
          focusObjectId: card.key,
          relatedObjectIds: plan.cards
            .filter((c) => c.key !== card.key && c.entity === card.entity)
            .map((c) => c.key)
            .slice(0, 8),
        },
      ],
      panels: [
        {
          type: {
            entity_card: 'entity',
            text_card: 'text',
            metric_card: 'metrics',
            comparison_table: 'comparison',
            timeline: 'timeline',
            news_card: 'news',
            video_card: 'video',
            location_card: 'map',
          }[card.type],
          title: card.title,
          body: body,
          sourceIds,
          items: selected.map((f) => ({
            label: f.label,
            value: f.value,
            detail: (f.entity || 'Retrieved source').slice(0, 160),
          })),
        },
      ],
    };
  });
  for (const chart of plan.charts) {
    const selected = choose(chart.factIds);
    const entries = selected.map((f) => {
      const match = f.value.match(/^([+-]?\d[\d,]*(?:\.\d+)?)(?:\s*([^\d]*))?$/);
      if (!match)
        throw Error(
          'Chart needs a single source-backed numeric value, not a range or approximation.',
        );
      return {
        label: (f.entity || f.label).slice(0, 60),
        value: Number(match[1].replaceAll(',', '')),
        unit: (match[2] || chart.unit).trim(),
        labelType: f.label,
      };
    });
    if (
      new Set(entries.map((e) => e.unit)).size !== 1 ||
      new Set(entries.map((e) => e.labelType.toLowerCase())).size !== 1
    )
      throw Error('Chart values must measure the same fact in the same units.');
    scenes.push({
      title: chart.title,
      narration: 'A comparison of the same sourced measure.',
      panels: [
        {
          type: chart.type,
          title: chart.title,
          unit: entries[0].unit.slice(0, 25),
          sourceIds: [...new Set(selected.map((f) => f.sourceId))].slice(0, 4),
          data: entries.map(({ label, value }) => ({ label, value })),
        },
      ],
    });
  }
  const images = sources
    .flatMap((s) => (s.images || []).filter((i) => imageIds.includes(i.id)).map((i) => ({ i, s })))
    .slice(0, 3);
  if (images.length)
    scenes.push({
      title: 'Reference imagery',
      relation: 'SUPPORTING_VISUAL',
      narration: 'Retrieved reference images with their sources.',
      panels: [
        {
          type: 'images',
          title: 'Reference imagery',
          sourceIds: [...new Set(images.map((x) => x.s.id))],
          imageIds: images.map((x) => x.i.id),
        },
      ],
    });
  scenes.push({
    title: 'Sources',
    relation: 'SOURCE',
    narration: 'Sources used for these verified facts.',
    panels: [
      {
        type: 'sources',
        title: 'Evidence and provenance',
        sourceIds: sources.slice(0, 4).map((s) => s.id),
      },
    ],
  });
  // Keep every selected card and chart: batch into renderer-sized groups rather
  // than silently truncating the final scenes at its per-message limit.
  return Array.from({ length: Math.ceil(scenes.length / 8) }, (_, i) =>
    briefingSchema.parse({
      title: plan.title,
      mode: i ? 'append' : 'replace',
      scenes: scenes.slice(i * 8, i * 8 + 8),
    }),
  );
}
module.exports = { workspacePlan, materialize, roles };

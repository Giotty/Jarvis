const { z } = require('zod');
const crypto = require('node:crypto');
const sourceId = z.string().min(1).max(200);
const panel = z
  .object({
    type: z.enum([
      'text',
      'metrics',
      'line',
      'area',
      'bar',
      'radial',
      'timeline',
      'images',
      'comparison',
      'news',
      'sources',
      'video',
      'map',
    ]),
    title: z.string().min(1).max(90),
    body: z.string().max(650).default(''),
    narration: z.string().max(400).default(''),
    sourceIds: z.array(sourceId).min(1).max(4),
    items: z
      .array(
        z
          .object({
            label: z.string().max(80),
            value: z.string().max(100),
            detail: z.string().max(160).default(''),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    data: z
      .array(z.object({ label: z.string().max(60), value: z.number().finite() }).strict())
      .max(12)
      .default([]),
    unit: z.string().max(25).default(''),
    imageIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .strict();
const briefingSchema = z
  .object({
    title: z.string().min(1).max(120),
    subtitle: z.string().max(180).default(''),
    scenes: z
      .array(
        z
          .object({
            title: z.string().min(1).max(90),
            narration: z.string().max(900).default(''),
            panels: z.array(panel).min(1).max(4),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
function numbers(value, found = new Set()) {
  if (typeof value === 'number') found.add(value);
  else if (typeof value === 'string')
    for (const number of value.match(/[-+]?\d[\d,]*(?:\.\d+)?/g) || [])
      found.add(Number(number.replaceAll(',', '')));
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) numbers(v, found);
  return found;
}
class BriefingEngine {
  constructor({ emit = () => {} } = {}) {
    this.emit = emit;
    this.sources = new Map();
    this.last = null;
  }
  begin(request) {
    this.request = request;
    this.sources.clear();
  }
  observe(step) {
    if (
      !['web_search', 'extract_page_text', 'find_video', 'get_weather', 'find_images'].includes(
        step.tool,
      ) ||
      !step.result?.success
    )
      return [];
    const result = step.result;
    const observations =
      result.sources ||
      result.results ||
      (result.url
        ? [result]
        : result.source
          ? [
              {
                ...result,
                url: typeof result.source === 'string' ? result.source : result.source.url,
                title: typeof result.location === 'string' ? result.location : 'Weather',
              },
            ]
          : []);
    const ids = [];
    for (const observation of observations.slice(0, 8)) {
      if (!observation.url || !/^https?:\/\//.test(observation.url)) continue;
      const existing = [...this.sources.values()].find((s) => s.url === observation.url);
      if (!existing && this.sources.size >= 40) continue;
      const id = existing?.id || observation.id || crypto.randomUUID();
      const source = { ...observation, id, title: observation.title || observation.url };
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      } catch {
        continue;
      }
      this.sources.set(id, source);
      ids.push({
        id,
        title: source.title,
        url: source.url,
        imageIds: (source.images || []).map((i) => i.id),
      });
    }
    if (ids.length) this.publish(this.automatic(), false);
    return ids;
  }
  automatic() {
    const sources = [...this.sources.values()],
      scenes = [];
    for (const source of sources.slice(0, 5)) {
      const panels = [
        {
          type: 'text',
          title: source.title,
          body: (source.text || source.snippet || 'Public source retrieved.').slice(0, 500),
          sourceIds: [source.id],
        },
      ];
      const videos = source.videos?.filter((v) => Number.isFinite(v.viewCount)).slice(0, 6);
      if (videos?.length) {
        panels[0].body =
          'Recent public uploads. View counts are retrieved snapshots and can change; Shorts are marked separately.';
        panels.push({
          type: 'bar',
          title: 'Public video views',
          sourceIds: [source.id],
          unit: 'views',
          data: videos.map((v) => ({
            label: (v.isShort ? 'Short · ' : '') + v.title.slice(0, 42),
            value: v.viewCount,
          })),
        });
      } else if (source.current) {
        panels.push({
          type: 'metrics',
          title: 'Current conditions',
          sourceIds: [source.id],
          items: Object.entries(source.current)
            .filter(([, v]) => typeof v === 'number')
            .slice(0, 4)
            .map(([label, value]) => ({
              label: label.replaceAll('_', ' '),
              value: String(value),
              detail: source.units?.[label] || '',
            })),
        });
      }
      if (source.images?.length)
        panels.push({
          type: 'images',
          title: 'Source imagery',
          sourceIds: [source.id],
          imageIds: source.images.slice(0, 2).map((i) => i.id),
        });
      scenes.push({
        title: source.title.slice(0, 90),
        narration: (source.text || source.snippet || '').slice(0, 500),
        panels,
      });
    }
    scenes.push({
      title: 'Sources',
      narration: 'These are the public sources used in this briefing.',
      panels: [
        {
          type: 'sources',
          title: 'Used in this briefing',
          sourceIds: sources.slice(0, 4).map((s) => s.id),
        },
      ],
    });
    return {
      title: (this.request || 'Research workspace').slice(0, 120),
      subtitle: 'Source observations · select Narrate for a guided presentation',
      scenes: scenes.slice(0, 8),
    };
  }
  present(input) {
    return this.publish(briefingSchema.parse(input), true);
  }
  publish(input, checked) {
    if (!this.sources.size) throw Error('Fetch research sources before presenting a briefing.');
    for (const scene of input.scenes)
      for (const p of scene.panels) {
        const selected = p.sourceIds.map((id) => {
          const source = this.sources.get(id);
          if (!source) throw Error('Briefing source must come from this task’s actual research.');
          return source;
        });
        const permitted = new Set(selected.flatMap((s) => (s.images || []).map((i) => i.id)));
        if ((p.imageIds || []).some((id) => !permitted.has(id)))
          throw Error('Image was not returned by the cited sources.');
        if ([p.items?.length, p.data?.length, p.imageIds?.length].filter(Boolean).length > 1)
          throw Error(
            'Use separate panels for item lists, charts and imagery to keep the briefing readable.',
          );
        if (checked && p.data?.length) {
          const observed = numbers(
            selected.map((s) => ({
              text: s.text,
              snippet: s.snippet,
              current: s.current,
              forecast: s.forecast,
              video: s.video,
              videos: s.videos,
            })),
          );
          if (p.data.some((d) => !observed.has(d.value)))
            throw Error(
              'Chart values must occur in the cited source observations. Do not invent chart data.',
            );
        }
      }
    const sources = [...this.sources.values()].map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      publishedAt: s.publishedAt,
      fetchedAt: typeof s.fetchedAt === 'string' ? Date.parse(s.fetchedAt) : s.fetchedAt,
      readable:
        s.readable === true || (s.readable !== false && !!(s.text || s.videos || s.current)),
      images: s.images || [],
    }));
    this.last = {
      ...input,
      id: crypto.randomUUID(),
      created: Date.now(),
      sources,
      modelOrganized: checked,
    };
    this.emit('briefing', this.last);
    return {
      success: true,
      verified: true,
      sceneCount: input.scenes.length,
      message:
        'Visual briefing displayed inside JARVIS. Use a concise final answer; the user can narrate the scenes.',
    };
  }
}
module.exports = { BriefingEngine, briefingSchema, numbers };

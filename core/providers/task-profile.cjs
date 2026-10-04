const { z } = require('zod');
const profileSchema = z.object({
  modality: z.enum(['text', 'image', 'screenshot', 'document', 'audio', 'mixed', 'spatial']),
  complexity: z.enum(['trivial', 'simple', 'normal', 'complex', 'very_complex']),
  latency: z.enum(['interactive', 'normal', 'patient']),
  timeframe: z.enum(['none', 'current', 'historical']).default('none'),
  vision: z.boolean(),
  tools: z.boolean(),
  deepReasoning: z.boolean(),
  research: z.boolean(),
  pcControl: z.boolean(),
  structuredOutput: z.boolean(),
  ocr: z.boolean(),
  documentParsing: z.boolean(),
  spatialReasoning: z.boolean(),
  privacy: z.enum(['public', 'local']),
  confidence: z.number().min(0).max(1),
});
const defaultProfile = Object.freeze({
  modality: 'text',
  complexity: 'normal',
  latency: 'interactive',
  timeframe: 'none',
  vision: false,
  tools: true,
  deepReasoning: false,
  research: false,
  pcControl: false,
  structuredOutput: false,
  ocr: false,
  documentParsing: false,
  spatialReasoning: false,
  privacy: 'public',
  confidence: 0,
});
function profileFacts(profile, { vision, tools, structured, localOnly, failures = 0 } = {}) {
  return {
    ...defaultProfile,
    ...profile,
    vision: !!vision,
    tools: !!tools,
    structuredOutput: !!structured,
    privacy: localOnly ? 'local' : profile?.privacy || 'public',
    previousFailures: failures,
  };
}
function roleFor(profile, mode = 'auto') {
  if (profile.vision) return 'vision';
  if (profile.spatialReasoning || profile.deepReasoning) return 'deep';
  if (profile.structuredOutput && !profile.deepReasoning && profile.previousFailures < 2)
    return 'fast';
  if (
    profile.previousFailures >= 2 ||
    (mode === 'prefer-quality' && ['complex', 'very_complex'].includes(profile.complexity))
  )
    return 'deep';
  if (
    mode === 'prefer-speed' ||
    (['trivial', 'simple'].includes(profile.complexity) && profile.confidence >= 0.7)
  )
    return 'fast';
  return 'general';
}
module.exports = { profileSchema, defaultProfile, profileFacts, roleFor };

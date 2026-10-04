// Catalog evidence is not runtime capability proof. Advanced features require a probe.
const catalog = [
  {
    id: 'moonshotai/kimi-k3',
    role: 'general',
    visionDocumented: true,
    reasoning: 'effort',
    free: true,
    evidence: 'https://build.nvidia.com/moonshotai/kimi-k3',
  },
  {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    role: 'fast',
    visionDocumented: false,
    reasoning: 'budget',
    free: true,
    evidence: 'https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    role: 'deep',
    visionDocumented: false,
    reasoning: 'template',
    free: true,
    evidence: 'https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b',
  },
  {
    id: 'deepseek-ai/deepseek-v4.1-flash',
    role: 'vision',
    visionDocumented: true,
    reasoning: 'none',
    free: true,
    evidence: 'https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash',
  },
  {
    id: 'z-ai/glm-5.3-flash',
    role: 'fallback',
    visionDocumented: false,
    reasoning: 'none',
    free: true,
    // Listed by authenticated /models. NVIDIA's API Catalog trial covers any
    // available catalog model; its Flash build page is currently unpublished.
    evidence: 'https://nvidia.github.io/GenerativeAIExamples/0.7.0/api-catalog.html',
  },
  {
    id: 'meta/muse-glimmer-30b',
    role: 'fallback',
    visionDocumented: false,
    reasoning: 'none',
    free: true,
    evidence: 'https://build.nvidia.com/meta/muse-glimmer-30b',
  },
];
module.exports = { catalog };

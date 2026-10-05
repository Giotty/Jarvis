// Optional generators return a validated self-contained GLB, never scripts.
// Blender is the primary modeler and the mandatory refinement/export backend.
class Generative3DProviders {
  constructor() {
    this.providers = new Map();
  }
  register(provider) {
    if (
      !provider?.id ||
      typeof provider.generate !== 'function' ||
      !Array.isArray(provider.modalities)
    )
      throw Error('Invalid 3D generator interface');
    this.providers.set(provider.id, { provider, enabled: false });
  }
  enable(id, enabled) {
    const entry = this.providers.get(id);
    if (!entry) throw Error('Unknown 3D generator');
    entry.enabled = enabled === true;
  }
  status() {
    return [...this.providers].map(([id, entry]) => ({
      id,
      enabled: entry.enabled,
      modalities: entry.provider.modalities,
      capabilities: entry.provider.capabilities,
      status: entry.provider.status?.(),
    }));
  }
  async generate(id, request, signal) {
    const entry = this.providers.get(id);
    if (!entry?.enabled) throw Error('3D generator disabled');
    signal?.throwIfAborted();
    const artifact = await entry.provider.generate(request, signal);
    signal?.throwIfAborted();
    if (artifact.format !== 'GLB' || !Buffer.isBuffer(artifact.buffer))
      throw Error('Generator must return a real GLB buffer.');
    require('./service.cjs').validateGlb(artifact.buffer);
    return artifact;
  }
}
module.exports = { Generative3DProviders };

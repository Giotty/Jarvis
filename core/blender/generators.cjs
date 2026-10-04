// Optional future mesh generators return validated operations, never Python.
// Blender remains the mandatory construction, rendering and export backend.
const { batch } = require('./schema.cjs');
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
    }));
  }
  async generate(id, request, signal) {
    const entry = this.providers.get(id);
    if (!entry?.enabled) throw Error('3D generator disabled');
    signal?.throwIfAborted();
    const operations = await entry.provider.generate(request, signal);
    signal?.throwIfAborted();
    return batch.parse(operations);
  }
}
module.exports = { Generative3DProviders };

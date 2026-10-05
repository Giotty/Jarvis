const { validateGlb } = require('./service.cjs');
const { z } = require('zod');
function endpoint(value) {
  const u = new URL(value);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && u.protocol !== 'https:')
  )
    throw Error('Use a local TRELLIS endpoint or an explicitly configured HTTPS hosted endpoint.');
  return u.href.replace(/\/$/, '');
}
class TrellisProvider {
  constructor({ config, secrets, fetcher = fetch }) {
    Object.assign(this, { config, secrets, fetcher });
    this.id = 'trellis';
    this.modalities = ['text', 'image'];
    this.capabilities = {
      textTo3D: true,
      imageTo3D: true,
      multiImageTo3D: false,
      availableVariants: ['base:text', 'large:text', 'large:image', 'large:text+large:image'],
      outputFormats: ['GLB'],
    };
    this.state = 'disabled';
    this.controller = null;
  }
  status() {
    return {
      state: this.state,
      capabilities: this.capabilities,
      enabled: this.config().trellisEnabled,
      installed: false,
    };
  }
  async healthCheck(signal) {
    if (!this.config().trellisEnabled)
      return { ready: false, reason: 'Optional provider disabled; Blender is primary.' };
    let response;
    try {
      response = await this.fetcher(endpoint(this.config().trellisUrl) + '/v1/health/ready', {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
        redirect: 'error',
      });
    } catch (error) {
      this.state = 'unavailable';
      throw error;
    }
    this.state = response.ok ? 'ready' : 'unavailable';
    return { ready: response.ok };
  }
  cancel() {
    this.controller?.abort();
  }
  async generate(request, signal) {
    if (!this.config().trellisEnabled) throw Error('TRELLIS is disabled; use Blender.');
    const mode = z.enum(['text', 'image']).parse(request.mode),
      variant = this.config().trellisVariant;
    if (mode === 'image' && !variant.includes('image'))
      throw Error('Configured TRELLIS variant does not support image input.');
    if (mode === 'text' && !variant.includes('text'))
      throw Error('Configured TRELLIS variant does not support text input.');
    const url = endpoint(this.config().trellisUrl),
      headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    // NGC is exclusively a container/catalog credential, never sent to inference hosts.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      const token = this.secrets?.get('trellis');
      if (token) headers.Authorization = 'Bearer ' + token;
    }
    this.controller = new AbortController();
    this.state = 'generating';
    const combined = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(300000),
      ...(signal ? [signal] : []),
    ]);
    const payload = {
      mode,
      seed: 0,
      ss_sampling_steps: 25,
      slat_sampling_steps: 25,
      ...(mode === 'text'
        ? { prompt: z.string().min(1).max(3000).parse(request.prompt) }
        : {
            image: z
              .string()
              .regex(/^data:image\/(png|jpeg|webp);base64,/)
              .max(16000000)
              .parse(request.image),
          }),
    };
    try {
      const response = await this.fetcher(url + '/v1/infer', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: combined,
        redirect: 'error',
      });
      if (!response.ok) throw Error('TRELLIS inference returned HTTP ' + response.status);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 48 * 1024 * 1024) throw Error('TRELLIS response exceeds safe mesh budget.');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')),
        encoded = data.artifacts?.[0]?.base64;
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(encoded))
        throw Error('TRELLIS returned no valid encoded GLB artifact.');
      const buffer = Buffer.from(encoded, 'base64');
      validateGlb(buffer);
      this.state = 'ready';
      return { format: 'GLB', buffer, provider: this.id, variant, mode };
    } catch (error) {
      this.state = combined.aborted ? 'cancelled' : 'unavailable';
      throw error;
    } finally {
      this.controller = null;
    }
  }
}
module.exports = { TrellisProvider, endpoint };

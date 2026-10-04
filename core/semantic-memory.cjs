const crypto = require('node:crypto');
const { z } = require('zod');
const finite = z.array(z.number().finite()).min(8).max(8192);
function cosine(a, b) {
  if (a.length !== b.length) return -1;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}
class SemanticMemory {
  constructor({ store, config, fetcher = fetch, library }) {
    Object.assign(this, { store, config, fetcher, library });
    store.db.run(
      'CREATE TABLE IF NOT EXISTS vectors(kind TEXT NOT NULL,id TEXT NOT NULL,model TEXT NOT NULL,fingerprint TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(kind,id));',
    );
  }
  async embed(text, signal) {
    const c = this.config(),
      nim = c.embeddingProvider === 'nim';
    if (nim && !c.nimEnabled) throw Error('Local NIM disabled');
    const url = new URL(
      nim
        ? c.nimUrl.replace(/\/$/, '') + '/embeddings'
        : c.ollamaUrl.replace(/\/$/, '') + '/api/embed',
    );
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password)
      throw Error('Memory embeddings must stay on this PC.');
    const model = nim ? 'nvidia/nemotron-3-embed-1b' : c.embeddingModel;
    const timeout = AbortSignal.timeout(15000);
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify(
        nim
          ? { model, input: text.slice(0, 2000) }
          : { model, input: text.slice(0, 2000), keep_alive: '2m', options: { num_gpu: 0 } },
      ),
    });
    if (!response.ok) throw Error('Local embedding service unavailable');
    const data = await response.json();
    return {
      model: (nim ? 'nim:' : 'ollama:') + model,
      vector: finite.parse(nim ? data.data?.[0]?.embedding : data.embeddings?.[0]),
    };
  }
  async search(query, signal, kind = 'memory') {
    if (!this.config().memory && kind === 'memory') throw Error('Memory disabled');
    const records = kind === 'memory' ? this.store.memories() : this.libraryRecords();
    if (!query) return records.slice(0, 15);
    const ids = new Set(records.map((r) => String(r.id)));
    for (const row of this.store.rows('SELECT id FROM vectors WHERE kind=?', [kind]))
      if (!ids.has(row.id))
        this.store.db.run('DELETE FROM vectors WHERE kind=? AND id=?', [kind, row.id]);
    const q = await this.embed(query, signal),
      indexed = [];
    for (const record of records.slice(0, 500)) {
      signal?.throwIfAborted();
      const fingerprint = crypto.createHash('sha256').update(record.content).digest('hex');
      let cached = this.store.rows('SELECT * FROM vectors WHERE kind=? AND id=?', [
        kind,
        String(record.id),
      ])[0];
      if (!cached || cached.model !== q.model || cached.fingerprint !== fingerprint) {
        const result = await this.embed(record.content, signal);
        if (result.model !== q.model) throw Error('Embedding model changed during retrieval');
        cached = { vector: JSON.stringify(result.vector) };
        this.store.db.run(
          'INSERT OR REPLACE INTO vectors(kind,id,model,fingerprint,vector) VALUES(?,?,?,?,?)',
          [kind, String(record.id), q.model, fingerprint, cached.vector],
        );
      }
      indexed.push({ ...record, score: cosine(q.vector, finite.parse(JSON.parse(cached.vector))) });
    }
    this.store.save();
    return indexed
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .filter((r) => r.score > 0.2);
  }
  libraryRecords() {
    return (this.library?.list() || []).map((entry) => {
      let detail = '';
      try {
        detail = this.library
          .read(entry.id)
          .workspace.modules.map(
            (m) =>
              m.title +
              ' ' +
              m.panels.map((p) => [p.title, p.body, ...(p.items || [])].join(' ')).join(' '),
          )
          .join('\n');
      } catch {
        /* Retain searchable title if a saved file is damaged. */
      }
      return {
        id: entry.id,
        category: 'library',
        content: (entry.topic + '\n' + detail).slice(0, 12000),
      };
    });
  }
  async retrieve(query, signal, kind = 'memory') {
    try {
      return {
        success: true,
        verified: true,
        retrieval: 'local-vector',
        observed_result: await this.search(query, signal, kind),
      };
    } catch (error) {
      signal?.throwIfAborted();
      const records = kind === 'memory' ? this.store.memories() : this.libraryRecords();
      return {
        success: true,
        verified: true,
        retrieval: 'keyword-fallback',
        message: error.message,
        observed_result: records
          .filter((m) => !query || m.content.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 15),
      };
    }
  }
}
module.exports = { SemanticMemory, cosine };

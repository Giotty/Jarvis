const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Searches are read-only and resume at the exact entry, including within a large folder.
// Links/junctions are reported but never followed; Windows permission failures are counted.
class FileSearch {
  constructor({ io = fs, budget = 4000, maxEntries = 30000, pageSize = 50 } = {}) {
    Object.assign(this, { io, budget, maxEntries, pageSize });
    this.sessions = new Map();
  }
  async search({ query, roots, scope, cursor, signal }) {
    const binding = JSON.stringify([query.toLowerCase(), scope, roots]);
    for (const [id, state] of this.sessions)
      if (Date.now() - state.updated > 600000) this.sessions.delete(id);
    let state;
    if (cursor) {
      state = this.sessions.get(cursor);
      if (!state || state.binding !== binding)
        throw Error('File search expired or scope changed; start a new search.');
      if (state.busy) throw Error('This file search is already running.');
    } else {
      while (this.sessions.size >= 6) this.sessions.delete(this.sessions.keys().next().value);
      state = {
        id: crypto.randomUUID(),
        binding,
        roots,
        pending: [...roots].reverse(),
        seen: new Set(),
        current: null,
        scanned: 0,
        skipped: 0,
        links: 0,
        updated: Date.now(),
      };
      this.sessions.set(state.id, state);
    }
    state.busy = true;
    const started = Date.now(),
      matches = [],
      entries = [];
    let scanned = 0;
    try {
      while (
        (state.current || state.pending.length) &&
        scanned < this.maxEntries &&
        Date.now() - started < this.budget &&
        matches.length < this.pageSize
      ) {
        signal?.throwIfAborted();
        if (!state.current) {
          const dir = state.pending.pop();
          const key = path.resolve(dir).toLowerCase();
          if (state.seen.has(key)) continue;
          state.seen.add(key);
          let items;
          try {
            items = await this.io.readdir(dir, { withFileTypes: true });
          } catch {
            state.skipped++;
            continue;
          }
          state.current = { dir, items, index: 0, children: [] };
        }
        const frame = state.current;
        if (frame.index === frame.items.length) {
          frame.children.sort(
            (a, b) =>
              Number(/(?:Documents|Downloads|Desktop)$/i.test(a)) -
              Number(/(?:Documents|Downloads|Desktop)$/i.test(b)),
          );
          state.pending.push(...frame.children);
          state.current = null;
          continue;
        }
        const entry = frame.items[frame.index++],
          file = path.join(frame.dir, entry.name);
        state.scanned++;
        scanned++;
        if (entry.name.toLowerCase().includes(query.toLowerCase())) {
          matches.push(file);
          entries.push({
            path: file,
            type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'folder' : 'file',
          });
        }
        if (entry.isSymbolicLink()) state.links++;
        else if (entry.isDirectory()) frame.children.push(file);
      }
      const complete = !state.current && !state.pending.length;
      this.sessions.delete(state.id);
      if (!complete) {
        // Each successful page is a distinct read, rather than a retry of the previous page.
        state.id = crypto.randomUUID();
        this.sessions.set(state.id, state);
      }
      return {
        success: true,
        verified: true,
        matches,
        entries,
        roots,
        scope,
        complete,
        truncated: !complete,
        cursor: complete ? null : state.id,
        scannedEntries: state.scanned,
        skippedDirectories: state.skipped,
        skippedLinks: state.links,
        message: complete
          ? 'Search completed in accessible folders. Inaccessible folders and links, if any, were skipped.'
          : 'Partial results: unsearched folders remain, but more matches are not guaranteed. Call search_files again with the same query, directory and NEW returned cursor to continue. Never reuse a consumed cursor or restart the scan to obtain new results. If this page has no matches, say no additional matches were found in this portion; do not present previously returned paths as new.',
      };
    } finally {
      state.busy = false;
      state.updated = Date.now();
    }
  }
}
module.exports = { FileSearch };

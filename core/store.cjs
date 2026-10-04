const fs = require('node:fs');
const path = require('node:path');
const init = require('sql.js');
class Store {
  async init(dir) {
    this.file = path.join(dir, 'jarvis.sqlite');
    fs.mkdirSync(dir, { recursive: true });
    const SQL = await init();
    this.db = new SQL.Database(fs.existsSync(this.file) ? fs.readFileSync(this.file) : undefined);
    this.db.run(
      'CREATE TABLE IF NOT EXISTS memory(id INTEGER PRIMARY KEY, category TEXT NOT NULL, content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);',
    );
    // A process restart cannot resume an old action or an old approval.
    for (const task of this.tasks()) {
      if (!['running', 'waiting'].includes(task.status)) continue;
      task.status = 'cancelled';
      task.finished = Date.now();
      task.steps
        .filter((step) => ['pending', 'running', 'waiting'].includes(step.status))
        .forEach((step) => {
          step.status = 'cancelled';
        });
      this.task(task);
    }
    return this;
  }
  rows(sql, params = []) {
    const s = this.db.prepare(sql);
    s.bind(params);
    const rows = [];
    while (s.step()) rows.push(s.getAsObject());
    s.free();
    return rows;
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', Buffer.from(this.db.export()));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  memories() {
    return this.rows('SELECT * FROM memory ORDER BY id DESC');
  }
  remember(category, content, id) {
    if (id)
      this.db.run('UPDATE memory SET category=?,content=? WHERE id=?', [category, content, id]);
    else this.db.run('INSERT INTO memory(category,content) VALUES(?,?)', [category, content]);
    if (id) this.invalidateVector(id);
    this.save();
    return this.memories();
  }
  forget(id) {
    this.db.run('DELETE FROM memory WHERE id=?', [id]);
    this.invalidateVector(id);
    this.save();
    return this.memories();
  }
  clear() {
    this.db.run('DELETE FROM memory');
    if (this.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'").length)
      this.db.run("DELETE FROM vectors WHERE kind='memory'");
    this.save();
  }
  invalidateVector(id) {
    if (this.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'").length)
      this.db.run("DELETE FROM vectors WHERE kind='memory' AND id=?", [String(id)]);
  }
  task(task) {
    const safe = {
      ...task,
      title: task.steps.map((s) => s.tool.replaceAll('_', ' ')).join(' → '),
      steps: task.steps.map(({ tool, risk, status }) => ({ tool, risk, status, args: {} })),
    };
    this.db.run('INSERT OR REPLACE INTO tasks(id,data) VALUES(?,?)', [
      task.id,
      JSON.stringify(safe),
    ]);
    this.db.run(
      'DELETE FROM tasks WHERE id NOT IN (SELECT id FROM tasks ORDER BY rowid DESC LIMIT 100)',
    );
    this.save();
  }
  tasks() {
    return this.rows('SELECT data FROM tasks ORDER BY rowid DESC').map((r) => JSON.parse(r.data));
  }
}
module.exports = { Store };

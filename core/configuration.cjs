const fs = require('node:fs');
const { schema, defaults } = require('./config.cjs');
function parse(text) {
  return schema.strip().parse(JSON.parse(text.replace(/^\uFEFF/, '')));
}
function readConfiguration(file) {
  try {
    return { config: parse(fs.readFileSync(file, 'utf8')), recovered: false };
  } catch (error) {
    if (error.code === 'ENOENT') return { config: defaults(), fresh: true };
    try {
      return { config: parse(fs.readFileSync(file + '.bak', 'utf8')), recovered: true };
    } catch {
      throw Error(
        'JARVIS settings could not be read. The saved settings were preserved; repair config.json or restore its backup before starting.',
      );
    }
  }
}
function writeConfiguration(file, next) {
  const config = schema.parse(next);
  let current;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== undefined) {
    let valid = true;
    try {
      parse(current);
    } catch {
      valid = false;
    }
    if (valid) fs.writeFileSync(file + '.bak', current);
    else parse(fs.readFileSync(file + '.bak', 'utf8'));
  }
  fs.writeFileSync(file + '.tmp', JSON.stringify(config, null, 2));
  fs.renameSync(file + '.tmp', file);
  return config;
}
module.exports = { readConfiguration, writeConfiguration };

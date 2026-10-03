const fs = require('node:fs');
const path = require('node:path');
class SecretStore {
  constructor(directory, encryption) {
    this.file = path.join(directory, 'secrets.enc.json');
    this.encryption = encryption;
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw Error('Encrypted credentials could not be read.', { cause: error });
    }
  }
  get(name) {
    const encoded = this.read()[name];
    if (!encoded) return '';
    if (!this.encryption.isEncryptionAvailable())
      throw Error('Windows credential encryption unavailable.');
    return this.encryption.decryptString(Buffer.from(encoded, 'base64'));
  }
  status() {
    return Object.fromEntries(Object.keys(this.read()).map((name) => [name, true]));
  }
  set(name, value) {
    if (!/^(?:openai|anthropic|gemini|mcp:[a-z][a-z0-9_-]{0,39})$/.test(name))
      throw Error('Unknown credential');
    if (typeof value !== 'string' || value.length > 8000) throw Error('Invalid credential');
    const data = this.read();
    if (value) {
      if (!this.encryption.isEncryptionAvailable())
        throw Error('Windows credential encryption unavailable.');
      data[name] = this.encryption.encryptString(value.trim()).toString('base64');
    } else delete data[name];
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data));
    fs.renameSync(this.file + '.tmp', this.file);
    return this.status();
  }
}
module.exports = { SecretStore };

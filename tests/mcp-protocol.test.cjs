const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MCPConnection } = require('../core/plugins/mcp.cjs');
test('MCP stdio performs actual protocol negotiation, discovery, schema failure and tool calls', async () => {
  const server = {
    id: 'sandbox',
    name: 'Sandbox',
    transport: 'stdio',
    command: process.execPath,
    args: [path.join(__dirname, 'fixtures', 'mcp-server.cjs')],
  };
  const connection = new MCPConnection(server, { get: () => '' });
  try {
    const tools = await connection.connect();
    assert.ok(tools.some((t) => t.name === 'lookup'));
    const result = await connection.call(
      'lookup',
      { query: 'previously unseen query' },
      undefined,
      3000,
    );
    assert.equal(result.success, true);
    assert.equal(result.verified, false);
    assert.ok(result.observed_result[0].includes('previously unseen query'));
    const invalid = await connection.call('lookup', { query: '' }, undefined, 3000);
    assert.equal(invalid.success, false);
    const failed = await connection.call('fail', {}, undefined, 3000);
    assert.equal(failed.success, false);
  } finally {
    await connection.close();
  }
});
test('MCP rejects implicit installation and insecure authenticated remote endpoints', async () => {
  await assert.rejects(
    () =>
      new MCPConnection(
        { id: 'bad', transport: 'stdio', command: 'npx', args: ['untrusted-package'] },
        { get: () => '' },
      ).connect(),
    /downloads/,
  );
  await assert.rejects(
    () =>
      new MCPConnection(
        { id: 'bad', transport: 'http', url: 'http://example.com/mcp' },
        { get: () => '' },
      ).connect(),
    /HTTPS/,
  );
  await assert.rejects(
    () =>
      new MCPConnection(
        { id: 'bad', transport: 'http', url: 'https://name:secret@example.com/mcp' },
        { get: () => '' },
      ).connect(),
    /credentials/,
  );
});

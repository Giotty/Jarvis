const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
class MCPConnection {
  constructor(server, secrets) {
    this.server = server;
    this.secrets = secrets;
  }
  async connect(signal) {
    const s = this.server;
    if (s.transport === 'stdio') {
      if (!s.command || /^(?:npx|npm|pnpm|uvx)(?:\.cmd|\.exe)?$/i.test(s.command))
        throw Error(
          'Supply an already installed MCP server executable; automatic downloads are disabled.',
        );
      this.transport = new StdioClientTransport({
        command: s.command,
        args: s.args,
        stderr: 'ignore',
        env: {
          ...process.env,
          ...(this.secrets.get('mcp:' + s.id)
            ? { JARVIS_PLUGIN_TOKEN: this.secrets.get('mcp:' + s.id) }
            : {}),
        },
      });
    } else {
      const url = new URL(s.url);
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
        throw Error('MCP requires HTTPS or loopback HTTP.');
      if (url.username || url.password) throw Error('Store MCP credentials in encrypted settings.');
      const token = this.secrets.get('mcp:' + s.id);
      this.transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: token ? { Authorization: 'Bearer ' + token } : {} },
      });
    }
    this.client = new Client({ name: 'jarvis', version: '0.2.0' });
    try {
      await this.client.connect(this.transport, { signal, timeout: 15000 });
      const tools = [];
      let cursor;
      do {
        const page = await this.client.listTools(cursor ? { cursor } : {}, {
          signal,
          timeout: 15000,
        });
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (tools.length > 150) throw Error('Plugin exposes too many tools.');
      } while (cursor);
      return tools;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async call(name, args, signal, timeout) {
    const reply = await this.client.callTool({ name, arguments: args }, undefined, {
      signal,
      timeout,
    });
    // An external server's success assertion is not independent verification.
    return {
      success: !reply.isError,
      verified: false,
      retryable: false,
      observed_result:
        reply.structuredContent ||
        reply.content?.filter((c) => c.type === 'text').map((c) => c.text),
      error: reply.isError ? 'plugin_failed' : null,
      message: reply.isError
        ? 'The plugin could not complete that step.'
        : 'The plugin returned a result; its effect has not been independently verified.',
    };
  }
  async close() {
    await this.client?.close().catch(() => {});
  }
}
module.exports = { MCPConnection };

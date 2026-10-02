const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const server = new McpServer({ name: 'jarvis-sandbox', version: '1.0.0' });
server.registerTool(
  'lookup',
  {
    description: 'Read sandbox data',
    inputSchema: { query: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => ({
    content: [{ type: 'text', text: JSON.stringify({ query, found: true }) }],
  }),
);
server.registerTool('fail', { description: 'Simulate failure', inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: 'text', text: 'Sandbox tool failed' }],
}));
server.connect(new StdioServerTransport()).catch(() => {
  process.exitCode = 1;
});

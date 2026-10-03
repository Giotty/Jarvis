const { test } = require('node:test');
const assert = require('node:assert/strict');
const { directIntent } = require('./legacy/intents.cjs');
const { searchUrl, chooseGame } = require('../core/web-actions.cjs');
const { Planner } = require('./legacy/planner.cjs');
const { Safety } = require('../core/safety.cjs');
const { validate, Executor } = require('../core/tools.cjs');
const { Ollama } = require('../core/ollama.cjs');

test('YouTube request performs a real encoded search without approval or misplaced typing', async () => {
  const calls = [],
    events = [];
  const executor = new Executor({
    config: () => ({ browser: true, mock: false }),
    host: {
      browser: {
        open: async (url) => {
          calls.push(url);
          return { success: true, verified: true, observed_result: { url } };
        },
      },
    },
    audit: { write() {} },
  });
  const p = new Planner({
    executor,
    ollama: {
      chat: async (messages) =>
        messages.at(-1).role === 'user' && !messages.some((m) => m.role === 'tool')
          ? {
              tool_calls: [
                {
                  function: {
                    name: 'search_web',
                    arguments: {
                      site: 'youtube',
                      query: messages.at(-1).content.includes('MrBeast')
                        ? 'MrBeast'
                        : 'cats & dogs',
                    },
                  },
                },
              ],
            }
          : { content: 'Search results are open.' },
    },
    safety: new Safety(),
    store: { task() {} },
    audit: { write() {} },
    emit: (type, data) => events.push({ type, data }),
  });
  await p.command('Open YouTube and search MrBeast');
  assert.equal(new URL(calls[0]).searchParams.get('search_query'), 'MrBeast');
  assert.equal(
    events.some((e) => e.type === 'confirmation'),
    false,
  );
  await p.command('search for cats & dogs');
  assert.equal(new URL(calls[1]).searchParams.get('search_query'), 'cats & dogs');
  assert.equal(new URL(searchUrl('google', 'a?b#c')).searchParams.get('q'), 'a?b#c');
});
test('Roblox distinguishes app launch, named games, missing names and game choices', () => {
  assert.equal(directIntent('open Roblox').tool, 'open_application');
  assert.deepEqual(directIntent('play Blox Fruits in Roblox'), {
    tool: 'play_roblox_game',
    args: { query: 'Blox Fruits' },
  });
  assert.match(directIntent('open a game in Roblox').reply, /Which Roblox game/);
  assert.equal(
    directIntent('play the second one', { games: [{ placeId: 1 }, { placeId: 2 }] }).args.placeId,
    2,
  );
  assert.equal(chooseGame('Blox Fruits', [{ name: 'Blox Fruits', placeId: 123 }]).placeId, 123);
  assert.equal(chooseGame('Fruit', [{ name: 'Fake Fruits', placeId: 456 }]), null);
});
test('multi-step requests reach the planner rather than losing actions in a search query', () => {
  assert.equal(directIntent('open YouTube and search MrBeast and play the first video'), null);
  assert.equal(directIntent('search YouTube for cats and dogs').args.query, 'cats and dogs');
});
test('dangerous actions retain confirmation; automatic typing cannot become a message-send tool', async () => {
  assert.equal(validate({ tool: 'fill_search', args: { text: 'MrBeast' } }).risk, 1);
  assert.equal(validate({ tool: 'type_text', args: { text: 'a message' } }).risk, 1);
  assert.equal(
    validate({ tool: 'type_text', args: { text: 'a command', confirmSensitive: true } }).risk,
    2,
  );
  assert.equal(validate({ tool: 'hotkey', args: { keys: ['enter'] } }).risk, 2);
  assert.equal(validate({ tool: 'delete_file', args: { path: 'x' } }).risk, 3);
  assert.equal(validate({ tool: 'navigate_ui', args: { label: 'Send' } }).risk, 2);
  const ex = new Executor({
    config: () => ({ browser: true, mock: false }),
    host: {},
    audit: { write() {} },
  });
  await assert.rejects(
    ex.execute({ tool: 'launch_roblox_game', args: { placeId: 123 } }),
    /unverified place IDs/,
  );
});
test('conversation follow-ups include the preceding user and assistant turn', async () => {
  let received;
  const p = new Planner({
    ollama: {
      chat: async (messages) => {
        received = structuredClone(messages);
        return { content: 'Understood.' };
      },
    },
    executor: {},
    safety: new Safety(),
    store: { task() {} },
    audit: { write() {} },
    emit() {},
  });
  await p.command('My favourite game is Blox Fruits');
  await p.command('Which game did I just mention?');
  assert.equal(received[1].content, 'My favourite game is Blox Fruits');
  assert.equal(received[2].content, 'Understood.');
});
test('streamed model content and complete tool calls survive split NDJSON chunks', async () => {
  const server = require('node:http').createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const frames =
      JSON.stringify({ message: { content: 'Ready, ' }, done: false }) +
      '\n' +
      JSON.stringify({
        message: {
          content: 'sir.',
          tool_calls: [
            { function: { name: 'search_web', arguments: { site: 'youtube', query: 'MrBeast' } } },
          ],
        },
        done: true,
      });
    res.write(frames.slice(0, 15));
    res.end(frames.slice(15));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const ai = new Ollama(() => ({ ollamaUrl: `http://127.0.0.1:${server.address().port}` }));
    const chunks = [];
    const result = await ai.request('/api/chat', { stream: true }, undefined, (text) =>
      chunks.push(text),
    );
    assert.equal(chunks.join(''), 'Ready, sir.');
    assert.equal(result.message.tool_calls[0].function.arguments.query, 'MrBeast');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

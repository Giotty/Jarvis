const { z } = require('zod');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { searchUrl, findRobloxGames, chooseGame } = require('./web-actions.cjs');
const text = z.string().min(1).max(8000),
  coord = z.number().int().min(-20000).max(20000);
const definitions = {
  open_youtube_result: {
    risk: 1,
    permission: 'browser',
    schema: z.object({ index: z.number().int().min(1).max(10) }).strict(),
    description: 'Open the first/second/etc visible YouTube video from the current browser page. Uses real accessible video links, never guessed coordinates. Automatic navigation; prefer over locate_ui_element for ordinal video requests.',
  },
  search_web: {
    risk: 1,
    permission: 'browser',
    schema: z
      .object({
        site: z.enum(['youtube', 'google', 'roblox']),
        query: z.string().trim().min(1).max(500),
      })
      .strict(),
    description:
      'Search YouTube, Google or Roblox directly in the browser. Automatic, no typing or search-bar clicks needed. Prefer for all web searches.',
  },
  find_roblox_games: {
    risk: 0,
    permission: 'browser',
    schema: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
    description:
      'Look up real Roblox games by name. Returns verified place IDs and creators; do not invent IDs.',
  },
  play_roblox_game: {
    risk: 1,
    permission: 'browser',
    schema: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
    description:
      'Find and launch a named Roblox game; returns choices if ambiguous. Use this instead of opening Roblox again. Ask which game if no name was given.',
  },
  launch_roblox_game: {
    risk: 1,
    permission: 'browser',
    schema: z
      .object({ placeId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
      .strict(),
    description:
      'Launch a Roblox place ID returned by find_roblox_games. Only known IDs may be launched.',
  },
  list_ui_elements: {
    risk: 0,
    schema: z.object({}).strict(),
    description:
      'Read real accessible controls in the foreground application. Prefer this before slow screen vision and before clicking or typing.',
  },
  fill_search: {
    risk: 1,
    permission: 'keyboard',
    schema: z
      .object({
        text: z.string().min(1).max(500),
        label: z.string().min(1).max(100).default('Search'),
      })
      .strict(),
    description:
      'Focus and fill a verified accessible Search edit field automatically; reads back its value to verify. Does not submit forms or send messages. Prefer search_web for browser searches.',
  },
  navigate_ui: {
    risk: 1,
    permission: 'mouse',
    schema: z
      .object({
        label: z.enum([
          'Search',
          'Home',
          'Back',
          'Forward',
          'Library',
          'Explore',
          'Subscriptions',
          'Games',
          'Videos',
        ]),
      })
      .strict(),
    description:
      'Click a uniquely identified ordinary navigation control automatically. Only these exact safe navigation labels are allowed. Other buttons use click_mouse with confirmation.',
  },
  close_application: {
    risk: 2,
    permission: 'keyboard',
    schema: z.object({ name: z.string().min(1).max(100) }).strict(),
    description:
      'Ask visible windows matching an application title to close gracefully; requires approval',
  },
  get_foreground_window: {
    risk: 0,
    schema: z.object({}).strict(),
    description: 'Read the current foreground window title and bounds',
  },
  analyze_screen: {
    risk: 0,
    schema: z.object({}).strict(),
    description: 'Capture and describe the visible screen using the local vision model',
  },
  locate_ui_element: {
    risk: 0,
    schema: z.object({ label: z.string().min(1).max(200) }).strict(),
    description:
      'Locate a named screen element; returns physical desktop coordinates and confidence. Use before proposing a click.',
  },
  remember_memory: {
    risk: 2,
    schema: z
      .object({
        category: z.enum([
          'preferences',
          'people',
          'applications',
          'commands',
          'shortcuts',
          'notes',
          'summaries',
        ]),
        content: z.string().min(1).max(2000),
      })
      .strict(),
    description:
      'Remember a preference or note only when explicitly requested, after approval. Never store credentials.',
  },
  open_application: {
    risk: 1,
    permission: 'browser',
    schema: z
      .object({
        name: z.enum(['notepad', 'calculator', 'explorer', 'spotify', 'chrome', 'edge', 'roblox']),
      })
      .strict(),
    description: 'Open an allowlisted installed application',
  },
  open_url: {
    risk: 1,
    permission: 'browser',
    schema: z
      .object({
        url: z
          .string()
          .url()
          .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol)),
      })
      .strict(),
    description: 'Open an HTTP(S) website in the normal browser',
  },
  move_mouse: {
    risk: 1,
    permission: 'mouse',
    schema: z.object({ x: coord, y: coord }).strict(),
    description: 'Move pointer to physical desktop coordinates',
  },
  click_mouse: {
    risk: 2,
    permission: 'mouse',
    schema: z
      .object({ x: coord, y: coord, button: z.enum(['left', 'right', 'double']).default('left') })
      .strict(),
    description: 'Click an exact screen coordinate; always requires confirmation',
  },
  scroll: {
    risk: 1,
    permission: 'mouse',
    schema: z.object({ amount: z.number().int().min(-20).max(20) }).strict(),
    description: 'Scroll foreground window',
  },
  type_text: {
    risk: 2,
    permission: 'keyboard',
    schema: z.object({ text, label: z.string().min(1).max(200).optional() }).strict(),
    description:
      'Focus a real accessible edit field by label, or use the already-focused edit field, and insert text with read-back verification. Requires confirmation for general fields. Never type before identifying the destination.',
  },
  hotkey: {
    risk: 2,
    permission: 'keyboard',
    schema: z
      .object({
        keys: z
          .array(
            z.enum([
              'ctrl',
              'alt',
              'shift',
              'win',
              'enter',
              'tab',
              'escape',
              'space',
              'a',
              'c',
              'v',
              'l',
              'w',
              't',
              'f',
              's',
              'd',
              'left',
              'right',
              'up',
              'down',
            ]),
          )
          .min(1)
          .max(4),
      })
      .strict(),
    description: 'Press a key combination; requires confirmation',
  },
  window_control: {
    risk: 2,
    permission: 'keyboard',
    schema: z.object({ action: z.enum(['close', 'minimize', 'maximize', 'switch']) }).strict(),
    description: 'Control the foreground window',
  },
  media: {
    risk: 0,
    permission: 'keyboard',
    schema: z
      .object({
        key: z.enum([
          'volumeup',
          'volumedown',
          'volumemute',
          'playpause',
          'nexttrack',
          'prevtrack',
        ]),
      })
      .strict(),
    description: 'Send media or volume key',
  },
  lock_pc: {
    risk: 2,
    permission: 'keyboard',
    schema: z.object({}).strict(),
    description: 'Lock Windows',
  },
  get_system_stats: {
    risk: 0,
    schema: z.object({}).strict(),
    description: 'Read current system telemetry',
  },
  list_running_apps: {
    risk: 0,
    schema: z.object({}).strict(),
    description: 'List top running processes',
  },
  read_clipboard: {
    risk: 2,
    permission: 'keyboard',
    schema: z.object({}).strict(),
    description: 'Read clipboard after approval; may contain sensitive information',
  },
  write_clipboard: {
    risk: 2,
    permission: 'keyboard',
    schema: z.object({ text }).strict(),
    description: 'Replace clipboard with literal text',
  },
  search_files: {
    risk: 0,
    permission: 'filesystem',
    schema: z.object({ query: z.string().min(1).max(100) }).strict(),
    description: 'Search filenames inside the selected file root',
  },
  open_file: {
    risk: 2,
    permission: 'filesystem',
    schema: z.object({ path: text }).strict(),
    description: 'Open a file or folder inside the selected root',
  },
  create_folder: {
    risk: 2,
    permission: 'filesystem',
    schema: z.object({ path: text }).strict(),
    description: 'Create a folder inside the selected root',
  },
  move_file: {
    risk: 2,
    permission: 'filesystem',
    schema: z.object({ source: text, destination: text }).strict(),
    description: 'Move or rename a file inside the root without overwriting',
  },
  delete_file: {
    risk: 3,
    permission: 'filesystem',
    schema: z.object({ path: text, permanent: z.boolean().default(false) }).strict(),
    description: 'Recycle a file after confirmation; permanent deletion is unsupported',
  },
  run_powershell: {
    risk: 3,
    permission: 'powershell',
    schema: z.object({ command: z.enum(['Get-Date', 'Get-ComputerInfo', 'Get-PSDrive']) }).strict(),
    description: 'Run one of three read-only PowerShell commands; no arbitrary shell',
  },
};
function validate(action) {
  if (!action || typeof action.tool !== 'string' || !definitions[action.tool])
    throw Error('Unknown tool');
  const d = definitions[action.tool];
  return {
    tool: action.tool,
    args: d.schema.parse(action.args),
    risk: action.tool === 'window_control' && action.args?.action !== 'close' ? 1 : d.risk,
    permission: d.permission,
  };
}
function toolSchemas() {
  return Object.entries(definitions).map(([name, d]) => {
    const shape = d.schema.shape;
    const properties = {};
    for (const [k, s] of Object.entries(shape)) {
      let inner = s;
      while (inner._def.innerType) inner = inner._def.innerType;
      properties[k] =
        inner instanceof z.ZodEnum
          ? { type: 'string', enum: inner.options }
          : inner instanceof z.ZodNumber
            ? { type: 'number' }
            : inner instanceof z.ZodBoolean
              ? { type: 'boolean' }
              : inner instanceof z.ZodArray
                ? { type: 'array', items: { type: 'string' } }
                : { type: 'string' };
    }
    return {
      type: 'function',
      function: {
        name,
        description: d.description,
        parameters: {
          type: 'object',
          properties,
          required: Object.entries(shape)
            .filter(([, s]) => !s.isOptional())
            .map(([k]) => k),
          additionalProperties: false,
        },
      },
    };
  });
}
async function safePath(root, input) {
  if (!root) throw Error('Choose a file root in Settings.');
  const base = await fs.realpath(root);
  const resolved = path.resolve(base, input);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Path must be a child of the selected file root.');
  let cursor = resolved;
  while (true) {
    try {
      const actual = await fs.realpath(cursor);
      const rel = path.relative(base, actual);
      if (rel.startsWith('..') || path.isAbsolute(rel))
        throw Error('Symlinks cannot escape the file root.');
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      cursor = path.dirname(cursor);
    }
  }
  return resolved;
}
function pythonCall(config, script, payload, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonPath, [script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Local worker timed out.'));
    }, timeout);
    child.stdout.on('data', (d) => {
      output += d;
      if (output.length > 2e6) {
        child.kill();
        reject(Error('Worker output too large'));
      }
    });
    child.stderr.on('data', (d) => (error += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(Error(`Python worker unavailable: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(
          Error(
            'Local worker failed. Install optional Python dependencies and check configuration.',
          ),
        );
      try {
        const result = JSON.parse(output);
        if (result.error) reject(Error(result.error));
        else resolve(result);
      } catch {
        reject(Error('Invalid local worker response.'));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
class Executor {
  constructor({ config, host, worker, audit }) {
    Object.assign(this, { config, host, worker, audit });
    this.games = new Map();
  }
  async execute(action) {
    const a = validate(action),
      c = this.config();
    if (a.permission && !c[a.permission]) throw Error(`${a.permission} control is disabled.`);
    this.audit.write('tool', { tool: a.tool, risk: a.risk, status: c.mock ? 'mock' : 'running' });
    if (
      c.mock &&
      ![
        'get_system_stats',
        'list_running_apps',
        'search_files',
        'analyze_screen',
        'locate_ui_element',
        'read_clipboard',
        'remember_memory',
        'get_foreground_window',
        'list_ui_elements',
        'find_roblox_games',
      ].includes(a.tool)
    )
      return { mock: true, message: `Simulated ${a.tool}; no PC input or file changes.` };
    const p = a.args;
    switch (a.tool) {
      case 'search_web': {
        const url = searchUrl(p.site, p.query);
        await this.host.openUrl(url);
        return {
          dispatched: true,
          site: p.site,
          query: p.query,
          url,
          message: `Opened ${p.site} search results for ${p.query}.`,
        };
      }
      case 'find_roblox_games':
      case 'play_roblox_game': {
        const matches = await findRobloxGames(p.query);
        matches.forEach((game) => this.games.set(game.placeId, game));
        if (a.tool === 'find_roblox_games') return { games: matches };
        const selected = chooseGame(p.query, matches);
        if (!selected)
          return {
            games: matches,
            needsChoice: true,
            message: matches.length
              ? `Which game? ${matches.map((g, i) => `${i + 1}. ${g.name} by ${g.creator || 'unknown creator'}`).join('; ')}`
              : `I couldn't find ${p.query} on Roblox. What is its exact name?`,
          };
        await pythonCall(c, this.worker, {
          tool: 'launch_roblox_game',
          args: { placeId: selected.placeId },
        });
        return {
          dispatched: true,
          game: selected,
          message: `Asked Roblox to launch ${selected.name}. Joining has not been verified.`,
        };
      }
      case 'launch_roblox_game': {
        const game = this.games.get(p.placeId);
        if (!game)
          throw Error('Look up that Roblox game first; unverified place IDs cannot be launched.');
        await pythonCall(c, this.worker, { tool: a.tool, args: p });
        return {
          dispatched: true,
          game,
          message: `Asked Roblox to launch ${game.name}. Joining has not been verified.`,
        };
      }
      case 'analyze_screen': {
        const result = await this.host.analyze();
        return {
          description: result.description,
          monitor: result.monitor,
          width: result.width,
          height: result.height,
        };
      }
      case 'locate_ui_element':
        return this.host.locate(p.label);
      case 'remember_memory':
        if (!c.memory) throw Error('Memory is disabled.');
        this.host.remember(p.category, p.content);
        return { success: true };
      case 'get_system_stats':
        return this.host.stats();
      case 'list_running_apps':
        return (await this.host.stats()).processes;
      case 'open_url':
        await this.host.openUrl(p.url);
        return { success: true };
      case 'read_clipboard':
        return { text: this.host.clipboard.readText() };
      case 'write_clipboard':
        this.host.clipboard.writeText(p.text);
        return { success: true };
      case 'search_files': {
        const root = await fs.realpath(c.fileRoot),
          found = [];
        let scanned = 0;
        async function walk(dir, depth) {
          if (depth > 5 || scanned > 5000) return;
          for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            scanned++;
            if (e.isSymbolicLink()) continue;
            const f = path.join(dir, e.name);
            if (e.name.toLowerCase().includes(p.query.toLowerCase())) found.push(f);
            if (e.isDirectory()) await walk(f, depth + 1);
          }
        }
        await walk(root, 0);
        return found.slice(0, 100);
      }
      case 'open_file': {
        const file = await safePath(c.fileRoot, p.path);
        if (/\.(exe|msi|bat|cmd|ps1|vbs|js|lnk|scr|com)$/i.test(file))
          throw Error('Executable files cannot be opened with this tool.');
        const error = await this.host.openPath(file);
        if (error) throw Error(error);
        return { success: true };
      }
      case 'create_folder':
        await fs.mkdir(await safePath(c.fileRoot, p.path), { recursive: false });
        return { success: true };
      case 'move_file': {
        const source = await safePath(c.fileRoot, p.source),
          destination = await safePath(c.fileRoot, p.destination);
        try {
          await fs.access(destination);
          throw Error('Destination already exists.');
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
        await fs.rename(source, destination);
        return { success: true };
      }
      case 'delete_file':
        if (p.permanent)
          throw Error('Permanent deletion is intentionally unavailable. Use the Recycle Bin.');
        await this.host.trash(await safePath(c.fileRoot, p.path));
        return { success: true };
      default:
        if (
          [
            'move_mouse',
            'click_mouse',
            'scroll',
            'type_text',
            'fill_search',
            'navigate_ui',
            'list_ui_elements',
            'hotkey',
            'window_control',
            'open_youtube_result',
          ].includes(a.tool)
        )
          return this.host.withTarget(() => pythonCall(c, this.worker, { ...a }));
        return pythonCall(c, this.worker, { ...a });
    }
  }
}
module.exports = { definitions, validate, toolSchemas, safePath, Executor, pythonCall };

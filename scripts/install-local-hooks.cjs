#!/usr/bin/env node
/** Install the bundled Claude Code hook locally without downloading anything. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_EVENTS = [
  'SessionStart', 'SessionEnd', 'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'PostToolUse', 'PostToolUseFailure'
];
const CODEX_EVENTS = [
  'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop',
  'PostToolUse', 'PreCompact', 'PostCompact'
];
const ANTIGRAVITY_EVENTS = ['PreToolUse'];
const EVENTS = CLAUDE_EVENTS;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function addHook(settings, eventName, command, options = {}) {
  settings.hooks ||= {};
  settings.hooks[eventName] ||= [];
  const groups = settings.hooks[eventName];
  const exists = groups.some(group => Array.isArray(group.hooks) &&
    group.hooks.some(hook => hook && hook.type === 'command' && hook.command === command));
  if (exists) return false;
  const handler = { type: 'command', command, timeout: 5 };
  if (options.async) handler.async = true;
  const group = { hooks: [handler] };
  if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') group.matcher = '*';
  groups.push(group);
  return true;
}

function installClaudeHooks(options = {}) {
  const home = options.home || os.homedir();
  const source = options.source || path.join(__dirname, 'vibemon_claude_hook.py');
  const hookDir = path.join(home, '.vibemon', 'hooks');
  const target = path.join(hookDir, 'claude.py');
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const command = `${python} ${JSON.stringify(target)}`;

  fs.mkdirSync(hookDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  try { fs.chmodSync(target, 0o700); } catch { /* Windows */ }

  const settings = readJson(settingsPath);
  let changed = false;
  for (const eventName of CLAUDE_EVENTS) changed = addHook(settings, eventName, command, { async: true }) || changed;
  if (changed || !fs.existsSync(settingsPath)) writeAtomic(settingsPath, settings);

  return { ok: true, target, settingsPath, changed, events: [...CLAUDE_EVENTS] };
}

function installCodexHooks(options = {}) {
  const home = options.home || os.homedir();
  const source = options.source || path.join(__dirname, 'vibemon_claude_hook.py');
  const hookDir = path.join(home, '.vibemon', 'hooks');
  const target = path.join(hookDir, 'codex.py');
  const settingsPath = path.join(home, '.codex', 'hooks.json');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const command = `${python} ${JSON.stringify(target)}`;

  fs.mkdirSync(hookDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  try { fs.chmodSync(target, 0o700); } catch { /* Windows */ }

  const settings = readJson(settingsPath);
  settings.description ||= 'VibeMon Local lifecycle recorder';
  let changed = false;
  for (const eventName of CODEX_EVENTS) changed = addHook(settings, eventName, command) || changed;
  if (changed || !fs.existsSync(settingsPath)) writeAtomic(settingsPath, settings);

  return {
    ok: true,
    target,
    settingsPath,
    changed,
    events: [...CODEX_EVENTS],
    requiresTrust: true,
    trustInstructions: 'Start a new Codex session, run /hooks, and trust the VibeMon Local hooks.'
  };
}

function installAntigravityHooks(workspace, options = {}) {
  if (!workspace) throw new Error('A workspace directory is required for Antigravity hooks');
  const root = path.resolve(workspace);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Workspace not found: ${root}`);
  const home = options.home || os.homedir();
  const source = options.source || path.join(__dirname, 'vibemon_claude_hook.py');
  const hookDir = path.join(home, '.vibemon', 'hooks');
  const target = path.join(hookDir, 'antigravity.py');
  const settingsPath = path.join(root, '.agents', 'hooks.json');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const command = process.platform === 'win32'
    ? `set VIBEMON_RUNTIME=antigravity&& set VIBEMON_HOOK_EVENT=PreToolUse&& ${python} ${JSON.stringify(target)}`
    : `VIBEMON_RUNTIME=antigravity VIBEMON_HOOK_EVENT=PreToolUse ${python} ${JSON.stringify(target)}`;

  fs.mkdirSync(hookDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  try { fs.chmodSync(target, 0o700); } catch { /* Windows */ }

  const settings = readJson(settingsPath);
  settings.enabled = true;
  settings.PreToolUse ||= [];
  const exists = settings.PreToolUse.some(hook => hook && hook.command === command);
  if (!exists) settings.PreToolUse.push({ matcher: 'run_command', command, timeout: 5 });
  if (!exists || !fs.existsSync(settingsPath)) writeAtomic(settingsPath, settings);
  return {
    ok: true, target, settingsPath, changed: !exists, events: [...ANTIGRAVITY_EVENTS],
    limitation: 'The documented workspace hook captures run_command tool invocations; process/resource sampling covers the rest of the IDE.'
  };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    let result;
    if (args[0] === '--codex') result = installCodexHooks();
    else if (args[0] === '--antigravity') result = installAntigravityHooks(args[1]);
    else result = installClaudeHooks();
    console.log(`Installed local hook: ${result.target}`);
    console.log(`Updated settings: ${result.settingsPath}`);
    console.log('All events are sent only to http://127.0.0.1:19280/events');
  } catch (error) {
    console.error(`Failed to install local hooks: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  installClaudeHooks, installCodexHooks, installAntigravityHooks, addHook,
  EVENTS, CLAUDE_EVENTS, CODEX_EVENTS, ANTIGRAVITY_EVENTS
};

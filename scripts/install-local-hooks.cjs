#!/usr/bin/env node
/** Install the bundled Claude Code hook locally without downloading anything. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS = [
  'SessionStart', 'SessionEnd', 'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'PostToolUse', 'PostToolUseFailure'
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function addHook(settings, eventName, command) {
  settings.hooks ||= {};
  settings.hooks[eventName] ||= [];
  const groups = settings.hooks[eventName];
  const exists = groups.some(group => Array.isArray(group.hooks) &&
    group.hooks.some(hook => hook && hook.type === 'command' && hook.command === command));
  if (exists) return false;
  const group = { hooks: [{ type: 'command', command, async: true, timeout: 5 }] };
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
  for (const eventName of EVENTS) changed = addHook(settings, eventName, command) || changed;
  if (changed || !fs.existsSync(settingsPath)) writeAtomic(settingsPath, settings);

  return { ok: true, target, settingsPath, changed, events: [...EVENTS] };
}

if (require.main === module) {
  try {
    const result = installClaudeHooks();
    console.log(`Installed local Claude hook: ${result.target}`);
    console.log(`Updated Claude settings: ${result.settingsPath}`);
    console.log('All events are sent only to http://127.0.0.1:19280/events');
  } catch (error) {
    console.error(`Failed to install local Claude hooks: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { installClaudeHooks, addHook, EVENTS };

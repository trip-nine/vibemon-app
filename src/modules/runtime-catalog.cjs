/** Built-in and user-extensible catalog of privacy-safe local AI runtimes. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TELEMETRY_LEVELS = new Set(['presence-only', 'hooks', 'workspace-hooks', 'local-api', 'event-api']);
const MAX_CUSTOM_SIGNATURES = 100;

const BUILTIN_RUNTIME_SIGNATURES = [
  { runtime: 'Claude', surface: 'Desktop', telemetry: 'presence-only', kind: 'app', pathContains: ['/Claude.app/'], installPaths: ['/Applications/Claude.app'] },
  { runtime: 'Codex', surface: 'Desktop', telemetry: 'presence-only', kind: 'app', pathContains: ['/ChatGPT.app/'], installPaths: ['/Applications/ChatGPT.app'] },
  { runtime: 'LM Studio', surface: 'Desktop', telemetry: 'local-api', kind: 'app', pathContains: ['/LM Studio.app/'], installPaths: ['/Applications/LM Studio.app'] },
  { runtime: 'Cursor', surface: 'IDE', telemetry: 'presence-only', kind: 'ide', pathContains: ['/Cursor.app/'], installPaths: ['/Applications/Cursor.app'] },
  { runtime: 'VS Code', surface: 'IDE', telemetry: 'presence-only', kind: 'ide', pathContains: ['/Visual Studio Code.app/'], installPaths: ['/Applications/Visual Studio Code.app'] },
  { runtime: 'Antigravity', surface: 'IDE', telemetry: 'workspace-hooks', kind: 'ide', pathContains: ['/Antigravity IDE.app/'], installPaths: ['/Applications/Antigravity IDE.app'] },
  { runtime: 'Antigravity', surface: 'Desktop', telemetry: 'presence-only', kind: 'app', pathContains: ['/Antigravity.app/'], installPaths: ['/Applications/Antigravity.app'] },
  { runtime: 'Kiro', surface: 'IDE', telemetry: 'presence-only', kind: 'ide', pathContains: ['/Kiro.app/'], installPaths: ['/Applications/Kiro.app'] },
  { runtime: 'Windsurf', surface: 'IDE', telemetry: 'presence-only', kind: 'ide', pathContains: ['/Windsurf.app/'], installPaths: ['/Applications/Windsurf.app'] },
  { runtime: 'Claude Code', surface: 'CLI', telemetry: 'hooks', kind: 'cli', executables: ['claude'] },
  { runtime: 'Codex CLI', surface: 'CLI', telemetry: 'hooks', kind: 'cli', executables: ['codex'] },
  { runtime: 'Antigravity CLI', surface: 'CLI', telemetry: 'workspace-hooks', kind: 'cli', executables: ['agy', 'antigravity'], pathContains: ['/.antigravity/'] },
  { runtime: 'Hermes Agent', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['hermes', 'hermes-agent'], pathContains: ['/.hermes/hermes-agent/'] },
  { runtime: 'Grok CLI', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['grok', 'grok-cli'], pathContains: ['/.grok/bin/'] },
  { runtime: 'Goose', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['goose'] },
  { runtime: 'Kimi Code CLI', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['kimi', 'kimi-cli'], pathContains: ['/.kimi-code/'] },
  { runtime: 'Gemini CLI', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['gemini'], pathContains: ['/@google/gemini-cli/'] },
  { runtime: 'OpenClaw', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['openclaw', 'openclaw-gateway'], pathContains: ['/.openclaw/'] },
  { runtime: 'OpenCode', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['opencode'], pathContains: ['/.opencode/'] },
  { runtime: 'Qwen Code', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['qwen', 'qwen-code'] },
  { runtime: 'Aider', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['aider'], pathContains: ['/.aider/'] },
  { runtime: 'Crush', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['crush'] },
  { runtime: 'Amp', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['amp'] },
  { runtime: 'GitHub Copilot CLI', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['copilot'] },
  { runtime: 'OpenHands', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['openhands'] },
  { runtime: 'Factory Droid', surface: 'CLI', telemetry: 'event-api', kind: 'cli', executables: ['droid'] },
  { runtime: 'LM Studio', surface: 'CLI', telemetry: 'local-api', kind: 'cli', executables: ['lms'] },
  { runtime: 'LM Studio', surface: 'Inference Engine', telemetry: 'local-api', kind: 'engine', executables: ['llama-server'] },
  { runtime: 'Ollama', surface: 'Local Model Server', telemetry: 'local-api', kind: 'engine', executables: ['ollama'] },
  { runtime: 'OpenRouter', surface: 'Provider', telemetry: 'event-api', kind: 'provider', executables: [] }
];

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength && !/[\u0000-\u001f]/.test(text) ? text : null;
}

function cleanExecutables(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map(item => cleanText(item, 128))
    .filter(item => item && !item.includes('/') && /^[a-zA-Z0-9._+-]+$/.test(item));
}

function cleanPaths(value, options = {}) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map(item => cleanText(item, 512)).filter(item => {
    if (!item) return false;
    return options.absolute ? (path.isAbsolute(item) || item.startsWith('~/')) : true;
  });
}

function normalizeCustomSignature(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const runtime = cleanText(item.runtime, 64);
  const surface = cleanText(item.surface, 64) || 'CLI';
  const telemetry = TELEMETRY_LEVELS.has(item.telemetry) ? item.telemetry : 'presence-only';
  const kind = cleanText(item.kind, 32) || 'custom';
  const executables = cleanExecutables(item.executables);
  const pathContains = cleanPaths(item.pathContains);
  const installPaths = cleanPaths(item.installPaths, { absolute: true });
  if (!runtime || (!executables.length && !pathContains.length && !installPaths.length)) return null;
  return { runtime, surface, telemetry, kind, executables, pathContains, installPaths, source: 'custom' };
}

function classifyFromSignatures(commandPath, signatures) {
  const command = String(commandPath || '').trim();
  if (!command) return null;
  const name = path.basename(command).toLowerCase();
  for (const signature of signatures) {
    if ((signature.pathContains || []).some(fragment => command.includes(fragment)) ||
        (signature.executables || []).some(executable => executable.toLowerCase() === name)) {
      return {
        runtime: signature.runtime, surface: signature.surface,
        telemetry: signature.telemetry, kind: signature.kind || 'custom'
      };
    }
  }
  return null;
}

class RuntimeCatalog {
  constructor(options = {}) {
    const home = options.home || os.homedir();
    this.signatureFile = options.signatureFile || path.join(home, '.vibemon', 'runtime-signatures.json');
    this.spawnSync = options.spawnSync || spawnSync;
    this.fs = options.fs || fs;
    this.cachedCustom = [];
    this.cachedMtime = -1;
    this.installCache = { timestamp: 0, value: [] };
  }

  customSignatures() {
    let stat;
    try { stat = this.fs.statSync(this.signatureFile); } catch {
      this.cachedCustom = [];
      this.cachedMtime = -1;
      return [];
    }
    if (stat.mtimeMs === this.cachedMtime) return this.cachedCustom;
    let parsed;
    try { parsed = JSON.parse(this.fs.readFileSync(this.signatureFile, 'utf8')); } catch { parsed = {}; }
    const items = Array.isArray(parsed) ? parsed : parsed.signatures;
    this.cachedCustom = (Array.isArray(items) ? items : [])
      .slice(0, MAX_CUSTOM_SIGNATURES).map(normalizeCustomSignature).filter(Boolean);
    this.cachedMtime = stat.mtimeMs;
    return this.cachedCustom;
  }

  signatures() {
    return [
      ...BUILTIN_RUNTIME_SIGNATURES.map(item => ({ ...item, source: 'built-in' })),
      ...this.customSignatures()
    ];
  }

  commandExists(command) {
    try {
      return this.spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
        stdio: 'ignore', timeout: 1000
      }).status === 0;
    } catch { return false; }
  }

  pathExists(file) {
    const expanded = file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
    try { return this.fs.existsSync(expanded); } catch { return false; }
  }

  catalog() {
    if (Date.now() - this.installCache.timestamp < 60000) return this.installCache.value;
    const value = this.signatures().map(signature => ({
      runtime: signature.runtime,
      surface: signature.surface,
      telemetry: signature.telemetry,
      kind: signature.kind,
      source: signature.source,
      executables: [...(signature.executables || [])],
      installed: (signature.executables || []).some(command => this.commandExists(command)) ||
        (signature.installPaths || []).some(file => this.pathExists(file))
    }));
    this.installCache = { timestamp: Date.now(), value };
    return value;
  }
}

module.exports = {
  BUILTIN_RUNTIME_SIGNATURES,
  RuntimeCatalog,
  classifyFromSignatures,
  normalizeCustomSignature
};

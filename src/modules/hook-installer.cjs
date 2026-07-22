/**
 * Local hook status inspector.
 *
 * The upstream app downloaded and executed an installer from docs.vibemon.io.
 * Local-only mode never downloads or executes remote code. Existing hook files
 * are detected and reported; installation must be performed from reviewed local
 * files by the operator.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Store = require('electron-store');

function homePath(...segments) { return path.join(os.homedir(), ...segments); }

const TOOLS = [
  {
    name: 'Claude Code', flag: '--claude', command: 'claude', homeDir: homePath('.claude'),
    hookFile: homePath('.claude', 'hooks', 'vibemon.py')
  },
  {
    name: 'Codex CLI', flag: '--codex', command: 'codex', homeDir: homePath('.codex'),
    hookFile: homePath('.codex', 'hooks', 'vibemon.py')
  },
  {
    name: 'Kiro IDE', flag: '--kiro', command: 'kiro', homeDir: homePath('.kiro'),
    hookFile: homePath('.kiro', 'hooks', 'vibemon.py')
  },
  {
    name: 'OpenClaw', flag: '--openclaw', command: 'openclaw', homeDir: homePath('.openclaw'),
    hookFile: homePath('.openclaw', 'extensions', 'vibemon-bridge', 'index.mjs')
  },
  {
    name: 'VibeMon Scripts', flag: '--vibemon', command: null, homeDir: homePath('.vibemon'),
    hookFile: homePath('.vibemon', 'vibemon_core.py'), sharedAssets: true
  }
];

const WHICH_COMMAND = process.platform === 'win32' ? 'where' : 'which';

function commandExists(command) {
  if (!command) return false;
  const result = spawnSync(WHICH_COMMAND, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function verifyInstallerScript(script, expectedHash) {
  if (!expectedHash) return false;
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(script, 'utf8').digest('hex') === expectedHash;
}

class HookInstaller {
  constructor() {
    this.store = new Store({ name: 'hook-installer-settings', defaults: { dismissed: [] } });
    this.isRunning = false;
    this.cachedStatuses = this.refreshStatuses();
  }

  isPresent(tool) {
    return tool.sharedAssets ? fs.existsSync(tool.homeDir) : commandExists(tool.command) || fs.existsSync(tool.homeDir);
  }

  hasHook(tool) { return fs.existsSync(tool.hookFile); }
  isChanged() { return false; }
  hasChanges() { return false; }

  isDismissed(tool) { return this.store.get('dismissed').includes(tool.flag); }

  dismiss(tools) {
    const dismissed = new Set(this.store.get('dismissed'));
    for (const tool of tools) dismissed.add(tool.flag);
    this.store.set('dismissed', [...dismissed]);
  }

  refreshStatuses() {
    this.cachedStatuses = TOOLS.map(tool => ({
      ...tool,
      present: this.isPresent(tool),
      hasHook: this.hasHook(tool),
      changed: false,
      installAvailable: false,
      localOnly: true
    }));
    return this.cachedStatuses;
  }

  getCachedStatuses() { return this.cachedStatuses.map(item => ({ ...item })); }

  getMissingTools() {
    return this.refreshStatuses().filter(tool =>
      !tool.sharedAssets && tool.present && !tool.hasHook && !this.isDismissed(tool)
    );
  }

  async checkForChanges() {
    this.refreshStatuses();
    return false;
  }

  async checkAndPrompt() {
    // Never prompts to download remote code.
    this.refreshStatuses();
  }

  async installTools(tools) {
    return tools.map(tool => ({
      tool,
      result: {
        ok: false,
        reason: 'local-only-manual-install-required',
        message: 'Remote hook installation is disabled. Install reviewed hook files locally.'
      }
    }));
  }

  installByFlag(flag) {
    const tool = TOOLS.find(item => item.flag === flag);
    return tool ? this.installTools([tool]) : Promise.resolve([]);
  }

  showResultSummary() {}
}

module.exports = { HookInstaller, TOOLS, verifyInstallerScript };

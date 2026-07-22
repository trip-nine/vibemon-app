jest.mock('fs');
jest.mock('child_process');
jest.mock('../scripts/install-local-hooks.cjs', () => ({
  installClaudeHooks: jest.fn(() => ({ ok: true, target: '/tmp/claude.py', settingsPath: '/tmp/settings.json', changed: true })),
  installCodexHooks: jest.fn(() => ({ ok: true, target: '/tmp/codex.py', settingsPath: '/tmp/hooks.json', changed: true, requiresTrust: true }))
}));
jest.mock('electron-store', () => jest.fn().mockImplementation(() => {
  const values = { dismissed: [] };
  return { get: key => values[key], set: (key, value) => { values[key] = value; } };
}));

const fs = require('fs');
const { spawnSync } = require('child_process');
const { installClaudeHooks, installCodexHooks } = require('../scripts/install-local-hooks.cjs');
const { HookInstaller, TOOLS } = require('../src/modules/hook-installer.cjs');

describe('HookInstaller local-only mode', () => {
  beforeEach(() => {
    fs.existsSync.mockReset().mockReturnValue(false);
    spawnSync.mockReset().mockReturnValue({ status: 1 });
    installClaudeHooks.mockClear();
    installCodexHooks.mockClear();
  });

  test('installs Claude from the bundled local adapter', async () => {
    const installer = new HookInstaller();
    const results = await installer.installByFlag('--claude');
    expect(results[0].result).toMatchObject({ ok: true, target: '/tmp/claude.py' });
    expect(installClaudeHooks).toHaveBeenCalledTimes(1);
    expect(installer.hasChanges()).toBe(false);
  });

  test('installs Codex from the bundled local adapter', async () => {
    const installer = new HookInstaller();
    const results = await installer.installByFlag('--codex');
    expect(results[0].result).toMatchObject({ ok: true, target: '/tmp/codex.py', requiresTrust: true });
    expect(installClaudeHooks).not.toHaveBeenCalled();
    expect(installCodexHooks).toHaveBeenCalledTimes(1);
  });

  test('does not download or install an unbundled adapter', async () => {
    const installer = new HookInstaller();
    const results = await installer.installByFlag('--kiro');
    expect(results[0].result).toMatchObject({ ok: false, reason: 'local-adapter-not-bundled' });
    expect(installClaudeHooks).not.toHaveBeenCalled();
    expect(installCodexHooks).not.toHaveBeenCalled();
  });

  test('detects an existing reviewed local hook', () => {
    fs.existsSync.mockImplementation(value => value === TOOLS[0].hookFile || value === TOOLS[0].homeDir);
    const installer = new HookInstaller();
    const status = installer.getCachedStatuses().find(tool => tool.flag === '--claude');
    expect(status.hasHook).toBe(true);
    expect(status.installAvailable).toBe(true);
  });
});

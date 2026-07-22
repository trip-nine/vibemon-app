jest.mock('fs');
jest.mock('child_process');
jest.mock('electron-store', () => jest.fn().mockImplementation(() => {
  const values = { dismissed: [] };
  return { get: key => values[key], set: (key, value) => { values[key] = value; } };
}));

const fs = require('fs');
const { spawnSync } = require('child_process');
const { HookInstaller, TOOLS } = require('../src/modules/hook-installer.cjs');

describe('HookInstaller local-only mode', () => {
  beforeEach(() => {
    fs.existsSync.mockReset().mockReturnValue(false);
    spawnSync.mockReset().mockReturnValue({ status: 1 });
  });

  test('reports local hook status without network installation', async () => {
    const installer = new HookInstaller();
    const results = await installer.installByFlag(TOOLS[0].flag);
    expect(results[0].result).toMatchObject({ ok: false, reason: 'local-only-manual-install-required' });
    expect(installer.hasChanges()).toBe(false);
  });

  test('detects an existing reviewed local hook', () => {
    fs.existsSync.mockImplementation(value => value === TOOLS[0].hookFile || value === TOOLS[0].homeDir);
    const installer = new HookInstaller();
    const status = installer.getCachedStatuses().find(tool => tool.flag === TOOLS[0].flag);
    expect(status.hasHook).toBe(true);
    expect(status.installAvailable).toBe(false);
  });
});

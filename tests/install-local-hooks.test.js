const fs = require('fs');
const os = require('os');
const path = require('path');
const { installClaudeHooks, EVENTS } = require('../scripts/install-local-hooks.cjs');

describe('installClaudeHooks', () => {
  let home;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibemon-hooks-')); });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  test('copies the bundled adapter and merges all lifecycle hooks', () => {
    const result = installClaudeHooks({ home });
    expect(fs.existsSync(result.target)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    for (const eventName of EVENTS) expect(settings.hooks[eventName]).toHaveLength(1);
  });

  test('is idempotent and does not duplicate handlers', () => {
    installClaudeHooks({ home });
    installClaudeHooks({ home });
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    for (const eventName of EVENTS) expect(settings.hooks[eventName]).toHaveLength(1);
  });
});

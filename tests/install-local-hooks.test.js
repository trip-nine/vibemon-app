const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  installClaudeHooks, installCodexHooks, EVENTS, CODEX_EVENTS
} = require('../scripts/install-local-hooks.cjs');

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

describe('installCodexHooks', () => {
  let home;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibemon-codex-hooks-')); });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  test('copies the bundled adapter and writes supported lifecycle hooks', () => {
    const result = installCodexHooks({ home });
    expect(fs.existsSync(result.target)).toBe(true);
    expect(result.requiresTrust).toBe(true);
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    for (const eventName of CODEX_EVENTS) expect(settings.hooks[eventName]).toHaveLength(1);
    for (const groups of Object.values(settings.hooks)) {
      expect(groups[0].hooks[0].async).toBeUndefined();
    }
  });

  test('is idempotent and preserves unrelated hooks', () => {
    const settingsPath = path.join(home, '.codex', 'hooks.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'existing' }] }] } }));
    installCodexHooks({ home });
    installCodexHooks({ home });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('existing');
    for (const eventName of CODEX_EVENTS) expect(settings.hooks[eventName]).toHaveLength(1);
  });
});

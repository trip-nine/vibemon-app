const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BUILTIN_RUNTIME_SIGNATURES, RuntimeCatalog, classifyFromSignatures, normalizeCustomSignature
} = require('../src/modules/runtime-catalog.cjs');

describe('runtime catalog', () => {
  test.each([
    ['hermes', 'Hermes Agent'],
    ['grok', 'Grok CLI'],
    ['agy', 'Antigravity CLI'],
    ['openclaw', 'OpenClaw'],
    ['goose', 'Goose'],
    ['kimi', 'Kimi Code CLI'],
    ['gemini', 'Gemini CLI'],
    ['opencode', 'OpenCode'],
    ['qwen-code', 'Qwen Code']
  ])('classifies %s as %s', (executable, runtime) => {
    expect(classifyFromSignatures(`/usr/local/bin/${executable}`, BUILTIN_RUNTIME_SIGNATURES)).toMatchObject({ runtime, surface: 'CLI' });
  });

  test('lists OpenRouter as an event-attributed provider rather than a fake process', () => {
    const entry = BUILTIN_RUNTIME_SIGNATURES.find(item => item.runtime === 'OpenRouter');
    expect(entry).toMatchObject({ surface: 'Provider', telemetry: 'event-api', executables: [] });
    expect(classifyFromSignatures('/usr/local/bin/openrouter', BUILTIN_RUNTIME_SIGNATURES)).toBeNull();
  });

  test('loads valid custom signatures and ignores unsafe entries', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibemon-catalog-'));
    const signatureFile = path.join(home, 'runtime-signatures.json');
    fs.writeFileSync(signatureFile, JSON.stringify({ signatures: [
      { runtime: 'My Agent', surface: 'CLI', executables: ['my-agent'] },
      { runtime: 'Unsafe', executables: ['../../bin/sh'] },
      { runtime: '', executables: ['empty-name'] }
    ] }));
    const catalog = new RuntimeCatalog({ signatureFile, spawnSync: () => ({ status: 1 }) });
    expect(catalog.customSignatures()).toEqual([expect.objectContaining({ runtime: 'My Agent', executables: ['my-agent'], source: 'custom' })]);
    expect(classifyFromSignatures('/opt/bin/my-agent', catalog.signatures())).toMatchObject({ runtime: 'My Agent' });
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('reports installed commands without launching them', () => {
    const calls = [];
    const catalog = new RuntimeCatalog({
      signatureFile: '/missing/runtime-signatures.json',
      spawnSync: (command, args) => { calls.push([command, ...args]); return { status: args[0] === 'hermes' ? 0 : 1 }; }
    });
    const hermes = catalog.catalog().find(item => item.runtime === 'Hermes Agent');
    expect(hermes.installed).toBe(true);
    expect(calls).toContainEqual([process.platform === 'win32' ? 'where' : 'which', 'hermes']);
  });

  test('validates custom signature fields', () => {
    expect(normalizeCustomSignature({ runtime: 'Local Bot', pathContains: ['/.local-bot/'] })).toMatchObject({ telemetry: 'presence-only' });
    expect(normalizeCustomSignature({ runtime: 'Bad', executables: ['a/b'] })).toBeNull();
  });
});

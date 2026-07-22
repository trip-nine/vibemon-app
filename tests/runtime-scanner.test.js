const {
  classifyProcess, parseProcessList
} = require('../src/modules/runtime-scanner.cjs');

describe('runtime scanner', () => {
  test('classifies CLI and desktop surfaces without command arguments', () => {
    expect(classifyProcess('/usr/local/bin/claude')).toMatchObject({ runtime: 'Claude Code', surface: 'CLI', telemetry: 'hooks' });
    expect(classifyProcess('/opt/bin/codex')).toMatchObject({ runtime: 'Codex CLI', surface: 'CLI', telemetry: 'hooks' });
    expect(classifyProcess('/Applications/Claude.app/Contents/MacOS/Claude')).toMatchObject({ runtime: 'Claude', surface: 'Desktop', telemetry: 'presence-only' });
    expect(classifyProcess('/Applications/ChatGPT.app/Contents/Resources/codex')).toMatchObject({ runtime: 'Codex', surface: 'Desktop', telemetry: 'presence-only' });
    expect(classifyProcess('/bin/zsh')).toBeNull();
  });

  test('parses only pid, parent pid, and executable path', () => {
    const result = parseProcessList(`
      100 1 ttys003 /usr/local/bin/claude
      101 1 ?? /Applications/Claude.app/Contents/MacOS/Claude
      102 1 ttys004 /bin/zsh
    `);
    expect(result).toEqual([
      { pid: 100, parentPid: 1, terminal: 'ttys003', runtime: 'Claude Code', surface: 'CLI', telemetry: 'hooks' },
      { pid: 101, parentPid: 1, terminal: null, runtime: 'Claude', surface: 'Desktop', telemetry: 'presence-only' }
    ]);
  });
});

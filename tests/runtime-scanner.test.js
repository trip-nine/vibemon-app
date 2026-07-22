const {
  RuntimeScanner, classifyProcess, parseElapsedTime, parseProcessList
} = require('../src/modules/runtime-scanner.cjs');

describe('runtime scanner', () => {
  test('classifies CLI, desktop, IDE, and local model surfaces', () => {
    expect(classifyProcess('/usr/local/bin/claude')).toMatchObject({ runtime: 'Claude Code', surface: 'CLI', telemetry: 'hooks' });
    expect(classifyProcess('/opt/bin/codex')).toMatchObject({ runtime: 'Codex CLI', surface: 'CLI', telemetry: 'hooks' });
    expect(classifyProcess('/Applications/Claude.app/Contents/MacOS/Claude')).toMatchObject({ runtime: 'Claude', surface: 'Desktop' });
    expect(classifyProcess('/Applications/LM Studio.app/Contents/MacOS/LM Studio')).toMatchObject({ runtime: 'LM Studio', surface: 'Desktop' });
    expect(classifyProcess('/Applications/Cursor.app/Contents/MacOS/Cursor')).toMatchObject({ runtime: 'Cursor', surface: 'IDE' });
    expect(classifyProcess('/Applications/Visual Studio Code.app/Contents/MacOS/Electron')).toMatchObject({ runtime: 'VS Code', surface: 'IDE' });
    expect(classifyProcess('/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE')).toMatchObject({ runtime: 'Antigravity', surface: 'IDE' });
    expect(classifyProcess('/models/bin/llama-server')).toMatchObject({ runtime: 'LM Studio', surface: 'Inference Engine' });
    expect(classifyProcess('/Users/demo/.local/bin/hermes')).toMatchObject({ runtime: 'Hermes Agent', surface: 'CLI' });
    expect(classifyProcess('/Users/demo/.local/bin/grok')).toMatchObject({ runtime: 'Grok CLI', surface: 'CLI' });
    expect(classifyProcess('/Users/demo/.local/bin/agy')).toMatchObject({ runtime: 'Antigravity CLI', surface: 'CLI' });
    expect(classifyProcess('/Users/demo/.local/bin/goose')).toMatchObject({ runtime: 'Goose', surface: 'CLI' });
    expect(classifyProcess('/Users/demo/.kimi-code/bin/kimi')).toMatchObject({ runtime: 'Kimi Code CLI', surface: 'CLI' });
    expect(classifyProcess('/bin/zsh')).toBeNull();
  });

  test('parses elapsed process time', () => {
    expect(parseElapsedTime('01:02')).toBe(62);
    expect(parseElapsedTime('01:02:03')).toBe(3723);
    expect(parseElapsedTime('2-01:02:03')).toBe(176523);
  });

  test('aggregates helper process trees and resource counters', () => {
    const result = parseProcessList(`
      100 1 1.5 1000 5000 01:02 ttys003 /usr/local/bin/claude
      101 100 2.5 2000 6000 00:31 ?? /some/helper
      200 1 0.5 3000 7000 1-01:00:00 ?? /Applications/Cursor.app/Contents/MacOS/Cursor
      201 200 4.5 4000 8000 00:12 ?? /Applications/Cursor.app/Contents/Frameworks/Cursor Helper
      300 1 3.0 5000 9000 00:05 ttys004 /bin/zsh
    `);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      pid: 100, runtime: 'Claude Code', processCount: 2, cpuPercent: 4,
      memoryBytes: 3000 * 1024, uptimeSeconds: 62, terminal: 'ttys003'
    });
    expect(result[1]).toMatchObject({
      pid: 200, runtime: 'Cursor', processCount: 2, cpuPercent: 5,
      memoryBytes: 7000 * 1024, uptimeSeconds: 90000
    });
  });

  test('folds detached Electron helpers into one desktop runtime', () => {
    const result = parseProcessList(`
      100 1 1.0 1000 5000 01:00 ?? /Applications/Cursor.app/Contents/MacOS/Cursor
      101 100 2.0 2000 6000 00:30 ?? /Applications/Cursor.app/Contents/Frameworks/Cursor Helper
      102 1 0.1 50 100 00:10 ?? /Applications/Cursor.app/Contents/Frameworks/chrome_crashpad_handler
    `);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ runtime: 'Cursor', processCount: 3, cpuPercent: 3.1, memoryBytes: 3050 * 1024 });
  });

  test('scanner never asks ps for command arguments', () => {
    const exec = jest.fn(() => '100 1 0.1 10 20 00:01 ?? /usr/local/bin/claude\n');
    const scanner = new RuntimeScanner({ execFileSync: exec });
    scanner.scan();
    expect(exec.mock.calls[0][1]).toEqual(['-axo', 'pid=,ppid=,%cpu=,rss=,vsz=,etime=,tty=,comm=']);
    expect(exec.mock.calls[0][1].join(' ')).not.toContain('command');
    expect(exec.mock.calls[0][1].join(' ')).not.toContain('args');
  });
});

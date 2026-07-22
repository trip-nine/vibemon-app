/** Local process-presence scanner for supported agent surfaces. */

const path = require('path');
const { execFileSync } = require('child_process');

function classifyProcess(commandPath) {
  const command = String(commandPath || '').trim();
  const name = path.basename(command).toLowerCase();

  if (command.includes('/Claude.app/Contents/MacOS/Claude')) {
    return { runtime: 'Claude', surface: 'Desktop', telemetry: 'presence-only' };
  }
  if (command.includes('/ChatGPT.app/Contents/MacOS/ChatGPT') ||
      command.includes('/ChatGPT.app/Contents/Resources/codex')) {
    return { runtime: 'Codex', surface: 'Desktop', telemetry: 'presence-only' };
  }
  if (name === 'claude') {
    return { runtime: 'Claude Code', surface: 'CLI', telemetry: 'hooks' };
  }
  if (name === 'codex') {
    return { runtime: 'Codex CLI', surface: 'CLI', telemetry: 'hooks' };
  }
  return null;
}

function parseProcessList(body) {
  const processes = [];
  for (const line of String(body || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
    if (!match) continue;
    const classified = classifyProcess(match[4]);
    if (!classified) continue;
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      terminal: match[3] === '??' ? null : match[3],
      ...classified
    });
  }
  return processes;
}

class RuntimeScanner {
  scan() {
    let output = '';
    try {
      output = execFileSync('ps', ['-axo', 'pid=,ppid=,tty=,comm='], {
        encoding: 'utf8',
        timeout: 1500,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch {
      return [];
    }
    return parseProcessList(output);
  }
}

module.exports = { RuntimeScanner, classifyProcess, parseProcessList };

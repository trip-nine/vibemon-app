/**
 * Privacy-preserving process and resource scanner for local AI runtimes.
 *
 * Only executable paths and process counters are requested from `ps`. Command
 * arguments, environment variables, prompts, file names, and document contents
 * are deliberately excluded.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const PROCESS_SIGNATURES = [
  { test: value => value.includes('/Claude.app/'), runtime: 'Claude', surface: 'Desktop', telemetry: 'presence-only' },
  { test: value => value.includes('/ChatGPT.app/'), runtime: 'Codex', surface: 'Desktop', telemetry: 'presence-only' },
  { test: value => value.includes('/LM Studio.app/'), runtime: 'LM Studio', surface: 'Desktop', telemetry: 'local-api' },
  { test: value => value.includes('/Cursor.app/'), runtime: 'Cursor', surface: 'IDE', telemetry: 'presence-only' },
  { test: value => value.includes('/Visual Studio Code.app/'), runtime: 'VS Code', surface: 'IDE', telemetry: 'presence-only' },
  { test: value => value.includes('/Antigravity IDE.app/'), runtime: 'Antigravity', surface: 'IDE', telemetry: 'workspace-hooks' },
  { test: value => value.includes('/Antigravity.app/'), runtime: 'Antigravity', surface: 'Desktop', telemetry: 'presence-only' },
  { test: value => value.includes('/Kiro.app/'), runtime: 'Kiro', surface: 'IDE', telemetry: 'presence-only' },
  { test: value => value.includes('/Windsurf.app/'), runtime: 'Windsurf', surface: 'IDE', telemetry: 'presence-only' }
];

const BASENAME_SIGNATURES = new Map([
  ['claude', { runtime: 'Claude Code', surface: 'CLI', telemetry: 'hooks' }],
  ['codex', { runtime: 'Codex CLI', surface: 'CLI', telemetry: 'hooks' }],
  ['lms', { runtime: 'LM Studio', surface: 'CLI', telemetry: 'local-api' }],
  ['llama-server', { runtime: 'LM Studio', surface: 'Inference Engine', telemetry: 'local-api' }],
  ['ollama', { runtime: 'Ollama', surface: 'Local Model Server', telemetry: 'local-api' }],
  ['aider', { runtime: 'Aider', surface: 'CLI', telemetry: 'presence-only' }],
  ['openclaw', { runtime: 'OpenClaw', surface: 'CLI', telemetry: 'presence-only' }],
  ['kiro-cli', { runtime: 'Kiro', surface: 'CLI', telemetry: 'presence-only' }],
  ['antigravity', { runtime: 'Antigravity', surface: 'CLI', telemetry: 'workspace-hooks' }]
]);

function classifyProcess(commandPath) {
  const command = String(commandPath || '').trim();
  if (!command) return null;
  for (const signature of PROCESS_SIGNATURES) {
    if (signature.test(command)) {
      return { runtime: signature.runtime, surface: signature.surface, telemetry: signature.telemetry };
    }
  }
  const name = path.basename(command).toLowerCase();
  return BASENAME_SIGNATURES.get(name) || null;
}

function parseElapsedTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const dayParts = text.split('-');
  const clock = dayParts.pop().split(':').map(Number);
  if (clock.some(number => !Number.isFinite(number))) return 0;
  let seconds = Number(dayParts[0] || 0) * 86400;
  if (clock.length === 3) seconds += (clock[0] * 3600) + (clock[1] * 60) + clock[2];
  else if (clock.length === 2) seconds += (clock[0] * 60) + clock[1];
  else seconds += clock[0];
  return seconds;
}

function parseRawProcessList(body) {
  const processes = [];
  for (const line of String(body || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/);
    if (!match) continue;
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      cpuPercent: Number(match[3]) || 0,
      memoryBytes: Number(match[4]) * 1024,
      virtualMemoryBytes: Number(match[5]) * 1024,
      uptimeSeconds: parseElapsedTime(match[6]),
      terminal: match[7] === '??' ? null : match[7],
      executable: match[8],
      classified: classifyProcess(match[8])
    });
  }
  return processes;
}

function ancestorPids(process, byPid) {
  const ancestors = [];
  const seen = new Set([process.pid]);
  let cursor = process;
  while (cursor && cursor.parentPid && !seen.has(cursor.parentPid)) {
    seen.add(cursor.parentPid);
    ancestors.push(cursor.parentPid);
    cursor = byPid.get(cursor.parentPid);
  }
  return ancestors;
}

function aggregateProcesses(rawProcesses) {
  const byPid = new Map(rawProcesses.map(process => [process.pid, process]));
  const classified = rawProcesses.filter(process => process.classified);
  const roots = classified.filter(process => {
    const key = `${process.classified.runtime}|${process.classified.surface}`;
    return !ancestorPids(process, byPid).some(pid => {
      const ancestor = byPid.get(pid);
      return ancestor && ancestor.classified &&
        `${ancestor.classified.runtime}|${ancestor.classified.surface}` === key;
    });
  });

  const groups = roots.map(root => {
    const rootKey = `${root.classified.runtime}|${root.classified.surface}`;
    const members = rawProcesses.filter(process => {
      if (process.pid === root.pid) return true;
      const ancestors = ancestorPids(process, byPid);
      const rootIndex = ancestors.indexOf(root.pid);
      if (rootIndex === -1) return false;
      return !ancestors.slice(0, rootIndex).some(pid => {
        const boundary = byPid.get(pid);
        return boundary && boundary.classified &&
          `${boundary.classified.runtime}|${boundary.classified.surface}` !== rootKey;
      }) && (!process.classified ||
        `${process.classified.runtime}|${process.classified.surface}` === rootKey);
    });
    const memoryBytes = members.reduce((total, process) => total + process.memoryBytes, 0);
    const virtualMemoryBytes = members.reduce((total, process) => total + process.virtualMemoryBytes, 0);
    const cpuPercent = members.reduce((total, process) => total + process.cpuPercent, 0);
    const terminals = [...new Set(members.map(process => process.terminal).filter(Boolean))];
    return {
      id: `${root.classified.runtime}:${root.classified.surface}:${root.pid}`,
      pid: root.pid,
      parentPid: root.parentPid,
      runtime: root.classified.runtime,
      surface: root.classified.surface,
      telemetry: root.classified.telemetry,
      confidence: root.classified.telemetry === 'hooks' ? 'adapter-capable' : 'observed',
      terminal: root.terminal || terminals[0] || null,
      processCount: members.length,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryBytes,
      virtualMemoryBytes,
      uptimeSeconds: root.uptimeSeconds,
      executableName: path.basename(root.executable),
      processPids: members.map(process => process.pid).sort((a, b) => a - b)
    };
  });

  // Electron frequently leaves crash reporters and update helpers re-parented
  // to launchd. Present those as part of the desktop/IDE, not as phantom apps.
  const collapsed = [];
  const desktopGroups = new Map();
  for (const group of groups) {
    if (!['Desktop', 'IDE'].includes(group.surface)) {
      collapsed.push(group);
      continue;
    }
    const key = `${group.runtime}|${group.surface}`;
    const existing = desktopGroups.get(key);
    if (!existing) {
      desktopGroups.set(key, { ...group });
      continue;
    }
    const primary = existing.processCount >= group.processCount ? existing : group;
    const secondary = primary === existing ? group : existing;
    desktopGroups.set(key, {
      ...primary,
      id: `${primary.runtime}:${primary.surface}:${primary.pid}`,
      processCount: primary.processCount + secondary.processCount,
      cpuPercent: Math.round((primary.cpuPercent + secondary.cpuPercent) * 10) / 10,
      memoryBytes: primary.memoryBytes + secondary.memoryBytes,
      virtualMemoryBytes: primary.virtualMemoryBytes + secondary.virtualMemoryBytes,
      processPids: [...new Set([...primary.processPids, ...secondary.processPids])].sort((a, b) => a - b)
    });
  }
  collapsed.push(...desktopGroups.values());
  return collapsed.sort((a, b) => a.runtime.localeCompare(b.runtime) || a.surface.localeCompare(b.surface) || a.pid - b.pid);
}

function parseProcessList(body) {
  return aggregateProcesses(parseRawProcessList(body));
}

class RuntimeScanner {
  constructor(options = {}) {
    this.execFileSync = options.execFileSync || execFileSync;
  }

  scan() {
    let output = '';
    try {
      output = this.execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,vsz=,etime=,tty=,comm='], {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 4 * 1024 * 1024
      });
    } catch {
      return [];
    }
    return parseProcessList(output);
  }
}

module.exports = {
  RuntimeScanner,
  aggregateProcesses,
  classifyProcess,
  parseElapsedTime,
  parseProcessList,
  parseRawProcessList
};

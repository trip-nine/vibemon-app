/** Append-only local process/resource history for detected AI runtimes. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { RuntimeScanner } = require('./runtime-scanner.cjs');
const { LmStudioConnector } = require('./lm-studio-connector.cjs');

const DEFAULT_INTERVAL_MS = 15000;
const MAX_SNAPSHOTS = 20000;

function dayKey(timestamp) {
  return timestamp.slice(0, 10);
}

class RuntimeMonitor {
  constructor(app, options = {}) {
    const userDataDir = app && typeof app.getPath === 'function'
      ? app.getPath('userData')
      : path.join(os.tmpdir(), 'vibemon-local');
    this.baseDir = options.baseDir || path.join(userDataDir, 'resource-history');
    this.scanner = options.scanner || new RuntimeScanner();
    this.lmStudio = options.lmStudio || new LmStudioConnector();
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.snapshots = [];
    this.timer = null;
    fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.baseDir, 0o700); } catch { /* best effort */ }
    this.load();
  }

  files() {
    return fs.readdirSync(this.baseDir)
      .filter(name => /^resources-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .slice(-31)
      .map(name => path.join(this.baseDir, name));
  }

  load() {
    const loaded = [];
    for (const file of this.files()) {
      let body = '';
      try { body = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        try { loaded.push(JSON.parse(line)); } catch { /* ignore damaged tail */ }
      }
    }
    this.snapshots = loaded.slice(-MAX_SNAPSHOTS);
  }

  sample() {
    const timestamp = new Date().toISOString();
    const snapshot = {
      timestamp,
      processes: this.scanner.scan(),
      lmStudio: this.lmStudio.inspect()
    };
    const file = path.join(this.baseDir, `resources-${dayKey(timestamp)}.jsonl`);
    try {
      fs.appendFileSync(file, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
    } catch { /* monitoring must never prevent the app from starting */ }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    return snapshot;
  }

  current() {
    return this.snapshots[this.snapshots.length - 1] || this.sample();
  }

  query(filters = {}) {
    const since = filters.since ? Date.parse(filters.since) : 0;
    const limit = Math.max(1, Math.min(Number(filters.limit) || 1000, 5000));
    return this.snapshots.filter(snapshot => !since || Date.parse(snapshot.timestamp) >= since).slice(-limit);
  }

  summary(filters = {}) {
    const snapshots = this.query(filters);
    const runtimes = new Map();
    for (const snapshot of snapshots) {
      for (const process of snapshot.processes || []) {
        const key = `${process.runtime}|${process.surface}`;
        const item = runtimes.get(key) || {
          runtime: process.runtime, surface: process.surface, samples: 0,
          peakCpuPercent: 0, peakMemoryBytes: 0, latest: null
        };
        item.samples += 1;
        item.peakCpuPercent = Math.max(item.peakCpuPercent, process.cpuPercent || 0);
        item.peakMemoryBytes = Math.max(item.peakMemoryBytes, process.memoryBytes || 0);
        item.latest = { timestamp: snapshot.timestamp, ...process };
        runtimes.set(key, item);
      }
    }
    return { snapshots: snapshots.length, runtimes: [...runtimes.values()], directory: this.baseDir };
  }

  start() {
    if (this.timer) return;
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { RuntimeMonitor };

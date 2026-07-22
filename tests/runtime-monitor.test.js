const fs = require('fs');
const os = require('os');
const path = require('path');
const { RuntimeMonitor } = require('../src/modules/runtime-monitor.cjs');

describe('runtime resource monitor', () => {
  let baseDir;
  beforeEach(() => { baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibemon-resources-')); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('records and summarizes process resource samples locally', () => {
    const scanner = { scan: jest.fn(() => [{ runtime: 'Cursor', surface: 'IDE', cpuPercent: 12.5, memoryBytes: 2048 }]) };
    const lmStudio = { inspect: jest.fn(() => ({ available: true, models: [] })) };
    const monitor = new RuntimeMonitor(null, { baseDir, scanner, lmStudio });
    const sample = monitor.sample();
    expect(sample.processes[0].runtime).toBe('Cursor');
    expect(monitor.summary()).toMatchObject({
      snapshots: 1,
      runtimes: [{ runtime: 'Cursor', surface: 'IDE', samples: 1, peakCpuPercent: 12.5, peakMemoryBytes: 2048 }]
    });
    expect(fs.readdirSync(baseDir)).toHaveLength(1);
  });
});

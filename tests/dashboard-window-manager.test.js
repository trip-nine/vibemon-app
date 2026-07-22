const mockInstances = [];

jest.mock('electron', () => {
  const { EventEmitter } = require('events');

  class MockBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = jest.fn();
      this.loadURL = jest.fn();
      this.show = jest.fn();
      this.focus = jest.fn();
      mockInstances.push(this);
    }

    isDestroyed() { return this.destroyed; }
    close() {
      this.destroyed = true;
      this.emit('closed');
    }
  }

  return { BrowserWindow: MockBrowserWindow };
});

const {
  DashboardWindowManager, DASHBOARD_URL, isDashboardUrl
} = require('../src/modules/dashboard-window-manager.cjs');

describe('DashboardWindowManager', () => {
  beforeEach(() => { mockInstances.length = 0; });

  test('opens the local dashboard in a sandboxed window', () => {
    const manager = new DashboardWindowManager();
    const window = manager.open();

    expect(window.loadURL).toHaveBeenCalledWith(DASHBOARD_URL);
    expect(window.options.show).toBe(false);
    expect(window.options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
    window.emit('ready-to-show');
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
  });

  test('reuses and foregrounds the existing window', () => {
    const manager = new DashboardWindowManager();
    const first = manager.open();
    const second = manager.open();

    expect(second).toBe(first);
    expect(mockInstances).toHaveLength(1);
    expect(first.show).toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalled();
  });

  test('allows only the loopback dashboard origin', () => {
    expect(isDashboardUrl('http://127.0.0.1:19280/history?limit=5')).toBe(true);
    expect(isDashboardUrl('https://example.com/')).toBe(false);
    expect(isDashboardUrl('http://localhost:19280/')).toBe(false);
  });

  test('blocks external navigation and cleans up', () => {
    const manager = new DashboardWindowManager();
    const window = manager.open();
    const event = { preventDefault: jest.fn() };

    window.webContents.emit('will-navigate', event, 'https://example.com/');
    expect(event.preventDefault).toHaveBeenCalled();
    manager.cleanup();
    expect(window.destroyed).toBe(true);
    expect(manager.window).toBeNull();
  });
});

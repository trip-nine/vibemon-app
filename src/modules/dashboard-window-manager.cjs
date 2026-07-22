/**
 * Owns the visible local observability dashboard window.
 *
 * The dashboard is served by HttpServer on loopback. Keeping it in a normal
 * BrowserWindow makes launching the installed app visibly useful instead of
 * silently starting only a menu-bar process.
 */

const { BrowserWindow } = require('electron');
const { URL } = require('url');
const { HTTP_PORT } = require('../shared/config.cjs');

const DASHBOARD_URL = `http://127.0.0.1:${HTTP_PORT}/`;

function isDashboardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port === String(HTTP_PORT);
  } catch {
    return false;
  }
}

class DashboardWindowManager {
  constructor() {
    this.window = null;
  }

  open() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'VibeMon Local',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.window = window;

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (!isDashboardUrl(targetUrl)) event.preventDefault();
    });
    window.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`Dashboard failed to load (${code}): ${description}`);
    });

    window.once('ready-to-show', () => {
      if (this.window === window && !window.isDestroyed()) {
        window.show();
        window.focus();
      }
    });
    window.once('closed', () => {
      if (this.window === window) this.window = null;
    });
    window.loadURL(DASHBOARD_URL);
    return window;
  }

  cleanup() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
  }
}

module.exports = { DashboardWindowManager, DASHBOARD_URL, isDashboardUrl };

/**
 * Manages ~/.vibemon/config.json as a loopback-only collector configuration.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { HTTP_PORT } = require('../shared/config.cjs');

const VIBEMON_HOME = path.join(os.homedir(), '.vibemon');
const VIBEMON_CONFIG_PATH = path.join(VIBEMON_HOME, 'config.json');
const DESKTOP_HTTP_URL = `http://127.0.0.1:${HTTP_PORT}`;

const VIBEMON_CONFIG_DEFAULTS = {
  debug: false,
  auto_launch: true,
  http_urls: [DESKTOP_HTTP_URL],
  serial_port: null,
  vibemon_url: '',
  vibemon_token: ''
};

function readRawConfig() {
  if (!fs.existsSync(VIBEMON_CONFIG_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(VIBEMON_CONFIG_PATH, 'utf8')); } catch { return undefined; }
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.'));
  } catch {
    return false;
  }
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const localUrls = Array.isArray(source.http_urls)
    ? source.http_urls.map(value => String(value).trim()).filter(isLoopbackUrl)
    : [];
  return {
    debug: Boolean(source.debug),
    auto_launch: source.auto_launch === undefined ? true : Boolean(source.auto_launch),
    http_urls: [...new Set([DESKTOP_HTTP_URL, ...localUrls])],
    serial_port: String(source.serial_port || '').trim() || null,
    // Cloud delivery credentials are deliberately erased.
    vibemon_url: '',
    vibemon_token: ''
  };
}

class VibemonConfigManager {
  getStatus() {
    const raw = readRawConfig();
    if (raw === null) return { exists: false, hasDesktopUrl: false, localOnly: true };
    if (raw === undefined) return { exists: true, hasDesktopUrl: false, localOnly: true };
    const config = normalizeConfig(raw);
    return { exists: true, hasDesktopUrl: config.http_urls.includes(DESKTOP_HTTP_URL), localOnly: true };
  }

  read() { return normalizeConfig(readRawConfig()); }

  write(partial) {
    const current = this.read();
    const next = { ...current };
    if (partial && typeof partial === 'object') {
      if (Object.prototype.hasOwnProperty.call(partial, 'debug')) next.debug = Boolean(partial.debug);
      if (Object.prototype.hasOwnProperty.call(partial, 'auto_launch')) next.auto_launch = Boolean(partial.auto_launch);
      if (Object.prototype.hasOwnProperty.call(partial, 'serial_port')) {
        next.serial_port = String(partial.serial_port || '').trim() || null;
      }
      if (Object.prototype.hasOwnProperty.call(partial, 'http_urls')) {
        const requested = Array.isArray(partial.http_urls) ? partial.http_urls : [];
        next.http_urls = [...new Set([DESKTOP_HTTP_URL, ...requested.map(value => String(value).trim()).filter(isLoopbackUrl)])];
      }
    }
    next.vibemon_url = '';
    next.vibemon_token = '';
    this.persist(next);
    return next;
  }

  addHttpUrl(url) {
    if (!isLoopbackUrl(url)) return this.read();
    const current = this.read();
    return this.write({ http_urls: [...current.http_urls, url] });
  }

  removeHttpUrl(url) {
    const current = this.read();
    if (url === DESKTOP_HTTP_URL) return current;
    return this.write({ http_urls: current.http_urls.filter(item => item !== url) });
  }

  ensureDesktopUrl() {
    const raw = readRawConfig();
    if (raw === undefined) {
      console.error(`[VibemonConfig] ${VIBEMON_CONFIG_PATH} is invalid JSON; leaving it untouched.`);
      return false;
    }
    const normalized = normalizeConfig(raw);
    const changed = raw === null || JSON.stringify(normalized) !== JSON.stringify(raw);
    if (changed) this.persist(normalized);
    return changed;
  }

  persist(config) {
    try {
      fs.mkdirSync(VIBEMON_HOME, { recursive: true });
      const tempPath = `${VIBEMON_CONFIG_PATH}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, { mode: 0o600 });
      try {
        fs.chmodSync(VIBEMON_HOME, 0o700);
        fs.chmodSync(tempPath, 0o600);
      } catch { /* best effort */ }
      fs.renameSync(tempPath, VIBEMON_CONFIG_PATH);
      return true;
    } catch (err) {
      console.error('[VibemonConfig] failed to save config:', err.message);
      return false;
    }
  }
}

module.exports = {
  VibemonConfigManager,
  VIBEMON_CONFIG_DEFAULTS,
  DESKTOP_HTTP_URL,
  isLoopbackUrl,
  normalizeConfig
};

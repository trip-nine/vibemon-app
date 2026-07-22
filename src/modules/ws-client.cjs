/**
 * Local-only collector facade.
 *
 * Cloud WebSocket relay support is intentionally removed. The class keeps the
 * existing UI-facing contract so the rest of the app can report Local only.
 */

class WsClient {
  constructor() {
    this.token = null;
    this.onStatusUpdate = null;
    this.onStatusDelete = null;
    this.onConnectionChange = null;
  }

  getToken() { return null; }
  setToken() { this.token = null; this.notifyConnectionChange(); }
  clearToken() { this.token = null; this.notifyConnectionChange(); }
  isConfigured() { return false; }
  getStatus() { return 'not-configured'; }
  getLastError() { return null; }
  connect() { this.notifyConnectionChange(); }
  reconnect() { this.notifyConnectionChange(); }
  disconnect() { this.notifyConnectionChange(); }
  cleanup() {}

  notifyConnectionChange() {
    if (this.onConnectionChange) this.onConnectionChange('not-configured');
  }
}

module.exports = { WsClient };

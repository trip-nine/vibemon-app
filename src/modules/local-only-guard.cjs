/**
 * Process-wide outbound network guard.
 *
 * VibeMon Local permits loopback traffic only. This blocks accidental cloud
 * telemetry from fetch/http/https/WebSocket/update libraries while preserving
 * the local collector on 127.0.0.1.
 */

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

const INSTALLED = Symbol.for('vibemon.localOnlyGuard.installed');

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHost(host) {
  const value = normalizeHost(host);
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' ||
    value.startsWith('127.');
}

function hostFromRequestArgs(args, defaultProtocol) {
  const first = args[0];
  if (typeof first === 'string' || first instanceof URL) {
    try {
      return new URL(first, `${defaultProtocol}//localhost`).hostname;
    } catch {
      return null;
    }
  }
  if (first && typeof first === 'object') {
    if (first.socketPath || first.path && !first.hostname && !first.host) return null;
    return first.hostname || first.host || 'localhost';
  }
  return 'localhost';
}

function hostFromConnectArgs(args) {
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    if (first.path || first.socket) return null;
    return first.host || first.hostname || 'localhost';
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) {
    // Unix domain socket path.
    return null;
  }
  return args[1] || 'localhost';
}

function assertLoopback(host, operation) {
  if (host === null || host === undefined || isLoopbackHost(host)) return;
  const error = new Error(`VibeMon Local blocked outbound ${operation} to ${host}`);
  error.code = 'VIBEMON_LOCAL_ONLY';
  throw error;
}

function wrapRequest(module, protocol) {
  const originalRequest = module.request.bind(module);
  const originalGet = module.get.bind(module);

  module.request = function localOnlyRequest(...args) {
    assertLoopback(hostFromRequestArgs(args, protocol), `${protocol.replace(':', '')} request`);
    return originalRequest(...args);
  };

  module.get = function localOnlyGet(...args) {
    assertLoopback(hostFromRequestArgs(args, protocol), `${protocol.replace(':', '')} request`);
    return originalGet(...args);
  };
}

function wrapConnect(module, method, label) {
  const original = module[method].bind(module);
  module[method] = function localOnlyConnect(...args) {
    assertLoopback(hostFromConnectArgs(args), label);
    return original(...args);
  };
}

function installLocalOnlyGuard() {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;

  wrapRequest(http, 'http:');
  wrapRequest(https, 'https:');
  wrapConnect(net, 'connect', 'TCP connection');
  wrapConnect(net, 'createConnection', 'TCP connection');
  wrapConnect(tls, 'connect', 'TLS connection');

  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async function localOnlyFetch(input, init) {
      const url = input instanceof URL ? input : new URL(
        typeof input === 'string' ? input : input.url,
        'http://localhost'
      );
      assertLoopback(url.hostname, 'fetch');
      return originalFetch(input, init);
    };
  }
}

module.exports = {
  installLocalOnlyGuard,
  isLoopbackHost,
  assertLoopback,
  hostFromRequestArgs,
  hostFromConnectArgs
};

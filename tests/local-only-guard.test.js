const {
  isLoopbackHost,
  assertLoopback,
  hostFromRequestArgs,
  hostFromConnectArgs
} = require('../src/modules/local-only-guard.cjs');

describe('local-only network guard', () => {
  test('allows loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '127.9.8.7', '::1']) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => assertLoopback(host, 'test')).not.toThrow();
    }
  });

  test('blocks cloud hosts', () => {
    expect(() => assertLoopback('vibemon.io', 'test')).toThrow(/blocked outbound/);
  });

  test('extracts hosts from common request/connect shapes', () => {
    expect(hostFromRequestArgs(['https://example.com/x'], 'https:')).toBe('example.com');
    expect(hostFromConnectArgs([{ host: 'localhost', port: 80 }])).toBe('localhost');
  });
});

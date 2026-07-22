const { WsClient } = require('../src/modules/ws-client.cjs');

describe('WsClient local-only facade', () => {
  test('is permanently not configured and never stores tokens', () => {
    const client = new WsClient();
    client.setToken('secret');
    expect(client.isConfigured()).toBe(false);
    expect(client.getStatus()).toBe('not-configured');
    expect(client.getToken()).toBeNull();
  });

  test('connect does not construct a network client', () => {
    const client = new WsClient();
    const callback = jest.fn();
    client.onConnectionChange = callback;
    client.connect();
    expect(callback).toHaveBeenCalledWith('not-configured');
  });
});

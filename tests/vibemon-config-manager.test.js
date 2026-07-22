jest.mock('fs');
jest.mock('../src/shared/config.cjs', () => ({ HTTP_PORT: 19280 }));

const fs = require('fs');
const {
  VibemonConfigManager,
  DESKTOP_HTTP_URL,
  isLoopbackUrl,
  normalizeConfig
} = require('../src/modules/vibemon-config-manager.cjs');

describe('VibemonConfigManager local-only invariants', () => {
  beforeEach(() => {
    fs.existsSync.mockReset().mockReturnValue(false);
    fs.readFileSync.mockReset();
    fs.writeFileSync.mockReset();
    fs.mkdirSync.mockReset();
    fs.chmodSync.mockReset();
    fs.renameSync.mockReset();
  });

  test('accepts loopback and rejects remote collector URLs', () => {
    expect(isLoopbackUrl('http://127.0.0.1:19280')).toBe(true);
    expect(isLoopbackUrl('http://localhost:3000')).toBe(true);
    expect(isLoopbackUrl('https://vibemon.io')).toBe(false);
  });

  test('erases cloud token/url and filters remote destinations', () => {
    const config = normalizeConfig({
      http_urls: ['https://vibemon.io/api/status', 'http://localhost:9999'],
      vibemon_url: 'https://vibemon.io',
      vibemon_token: 'secret'
    });
    expect(config.http_urls).toEqual([DESKTOP_HTTP_URL, 'http://localhost:9999']);
    expect(config.vibemon_url).toBe('');
    expect(config.vibemon_token).toBe('');
  });

  test('write always retains the desktop loopback endpoint', () => {
    const manager = new VibemonConfigManager();
    const result = manager.write({ http_urls: ['https://example.com'] });
    expect(result.http_urls).toEqual([DESKTOP_HTTP_URL]);
  });
});

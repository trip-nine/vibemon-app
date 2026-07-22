const { UsageRefresher } = require('../src/modules/usage-refresher.cjs');

describe('UsageRefresher local-only mode', () => {
  test('does not spawn Claude or contact a provider', async () => {
    const result = await new UsageRefresher().refresh();
    expect(result).toEqual({ ok: false, reason: 'local-only-disabled' });
  });
});

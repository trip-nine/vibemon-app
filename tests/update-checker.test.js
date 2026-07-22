const { UpdateChecker } = require('../src/modules/update-checker.cjs');

describe('UpdateChecker local-only mode', () => {
  test('never checks or downloads remote releases', async () => {
    const checker = new UpdateChecker();
    expect(checker.getState()).toEqual({ status: null, version: null });
    await expect(checker.checkForUpdates()).resolves.toBeNull();
    await expect(checker.downloadAndInstall('9.9.9')).resolves.toBeNull();
    expect(checker.installDownloaded()).toBe(false);
  });
});

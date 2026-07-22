/** Local-only builds never contact GitHub Releases or download updates. */
class UpdateChecker {
  constructor() {
    this.state = { status: null, version: null };
    this.onStateChanged = null;
  }
  getState() { return { ...this.state }; }
  async checkForUpdates() { return null; }
  async downloadAndInstall() { return null; }
  installDownloaded() { return false; }
}
module.exports = { UpdateChecker };

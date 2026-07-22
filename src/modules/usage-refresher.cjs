/**
 * Provider usage refresh is disabled in local-only mode because invoking
 * `claude -p /usage` can create provider network traffic. Hooks may still send
 * token totals they already receive in their local lifecycle payloads.
 */
const path = require('path');
const os = require('os');
const USAGE_SCRIPT_PATH = path.join(os.homedir(), '.vibemon', 'usage.py');
class UsageRefresher {
  refresh() { return Promise.resolve({ ok: false, reason: 'local-only-disabled' }); }
}
module.exports = { UsageRefresher, USAGE_SCRIPT_PATH };

/** Read LM Studio's local CLI state without starting its network server. */

const { execFileSync } = require('child_process');

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeModel(item) {
  if (!item || typeof item !== 'object') return null;
  const identifier = item.identifier || item.modelKey || item.path || item.name;
  if (!identifier) return null;
  return {
    identifier: String(identifier).slice(0, 512),
    displayName: item.displayName ? String(item.displayName).slice(0, 256) : null,
    architecture: item.architecture ? String(item.architecture).slice(0, 128) : null,
    quantization: item.quantization
      ? String(typeof item.quantization === 'object' ? item.quantization.name : item.quantization).slice(0, 128)
      : null,
    status: item.status ? String(item.status).slice(0, 64) : null,
    sizeBytes: finiteNumber(item.sizeBytes),
    contextLength: finiteNumber(item.contextLength),
    maxContextLength: finiteNumber(item.maxContextLength),
    parallelRequests: finiteNumber(item.parallelRequests || item.parallel)
  };
}

function parseModels(body) {
  let parsed;
  try { parsed = JSON.parse(String(body || '')); } catch { return []; }
  const candidates = Array.isArray(parsed) ? parsed : (parsed.models || parsed.loadedModels || []);
  if (!Array.isArray(candidates)) return [];
  return candidates.map(normalizeModel).filter(Boolean).slice(0, 100);
}

class LmStudioConnector {
  constructor(options = {}) {
    this.execFileSync = options.execFileSync || execFileSync;
  }

  inspect() {
    try {
      const output = this.execFileSync('lms', ['ps', '--json'], {
        encoding: 'utf8', timeout: 2500, maxBuffer: 2 * 1024 * 1024
      });
      return { available: true, models: parseModels(output), error: null };
    } catch (error) {
      return {
        available: false,
        models: [],
        error: error && error.code === 'ENOENT' ? 'lms-cli-not-found' : 'lms-cli-unavailable'
      };
    }
  }
}

module.exports = { LmStudioConnector, normalizeModel, parseModels };

/**
 * Bundled registry resolver for local-only mode.
 *
 * No remote registry or character image fetches are performed. A previously
 * validated local cache may still be used, otherwise bundled data wins.
 */

const fs = require('fs');
const path = require('path');
const bundledStates = require('./data/states.json');
const bundledCharacters = require('./data/characters.json');

const STATIC_BASE_URL = null;
const EYE_TYPES = new Set(['normal', 'glasses', 'blink', 'happy']);
const EFFECTS = new Set(['none', 'sparkle', 'thinking', 'question', 'zzz', 'exclamation']);
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const REGISTRY_NAME = /^[a-z0-9_-]{1,32}$/;
const IMAGE_FILE = /^[a-z0-9_-]{1,64}\.png$/;
const MAX_TEXT_LENGTH = 32;
const REQUIRED_STATES = Object.keys(bundledStates.states);

function getCacheDir() {
  if (process.env.VIBEMON_REGISTRY_CACHE_DIR) return process.env.VIBEMON_REGISTRY_CACHE_DIR;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return path.join(app.getPath('userData'), 'registry');
  } catch { /* tests/non-Electron */ }
  return null;
}

function isFiniteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function sanitizeStatesRegistry(json) {
  if (!json || typeof json !== 'object' || !json.states || typeof json.states !== 'object') return null;
  const states = {};
  for (const [name, entry] of Object.entries(json.states)) {
    const required = REQUIRED_STATES.includes(name);
    const valid = REGISTRY_NAME.test(name) && entry && typeof entry === 'object' &&
      typeof entry.color === 'string' && HEX_COLOR.test(entry.color) &&
      typeof entry.text === 'string' && entry.text.length >= 1 && entry.text.length <= MAX_TEXT_LENGTH &&
      typeof entry.active === 'boolean' && typeof entry.loading === 'boolean';
    if (!valid) {
      if (required) return null;
      continue;
    }
    states[name] = {
      color: entry.color,
      text: entry.text,
      active: entry.active,
      loading: entry.loading,
      eyeType: EYE_TYPES.has(entry.eyeType) ? entry.eyeType : 'normal',
      effect: EFFECTS.has(entry.effect) ? entry.effect : 'none'
    };
  }
  for (const name of REQUIRED_STATES) if (!states[name]) return null;
  return { states };
}

function sanitizeEyes(eyes) {
  if (!eyes || typeof eyes !== 'object') return null;
  const point = p => p && isFiniteInRange(p.x, 0, 128) && isFiniteInRange(p.y, 0, 128)
    ? { x: p.x, y: p.y } : null;
  const left = point(eyes.left);
  const right = point(eyes.right);
  if (!left || !right) return null;
  if (isFiniteInRange(eyes.size, 1, 64)) return { left, right, size: eyes.size };
  if (isFiniteInRange(eyes.w, 1, 64) && isFiniteInRange(eyes.h, 1, 64)) {
    return { left, right, w: eyes.w, h: eyes.h };
  }
  return null;
}

function sanitizeCharactersRegistry(json) {
  if (!json || typeof json !== 'object' || !json.characters || typeof json.characters !== 'object') return null;
  const characters = {};
  for (const [name, entry] of Object.entries(json.characters)) {
    if (!REGISTRY_NAME.test(name) || !entry || typeof entry !== 'object') continue;
    const eyes = sanitizeEyes(entry.eyes);
    const effect = entry.effect && isFiniteInRange(entry.effect.x, 0, 128) && isFiniteInRange(entry.effect.y, 0, 128)
      ? { x: entry.effect.x, y: entry.effect.y } : null;
    if (!(typeof entry.displayName === 'string' && entry.displayName.length >= 1 && entry.displayName.length <= MAX_TEXT_LENGTH &&
      typeof entry.color === 'string' && HEX_COLOR.test(entry.color) &&
      typeof entry.image === 'string' && IMAGE_FILE.test(entry.image) && eyes && effect)) continue;
    characters[name] = { displayName: entry.displayName, color: entry.color, image: entry.image, eyes, effect };
    if (typeof entry.eyeColor === 'string' && HEX_COLOR.test(entry.eyeColor)) characters[name].eyeColor = entry.eyeColor;
    if (typeof entry.glassesColor === 'string' && HEX_COLOR.test(entry.glassesColor)) characters[name].glassesColor = entry.glassesColor;
  }
  if (typeof json.default !== 'string' || !characters[json.default]) return null;
  return { default: json.default, characters };
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function loadRegistries() {
  const dir = getCacheDir();
  const states = dir ? sanitizeStatesRegistry(readJsonSafe(path.join(dir, 'states.json'))) : null;
  const characters = dir ? sanitizeCharactersRegistry(readJsonSafe(path.join(dir, 'characters.json'))) : null;
  return { statesRegistry: states || bundledStates, charactersRegistry: characters || bundledCharacters };
}

async function refresh() { return false; }

const { statesRegistry, charactersRegistry } = loadRegistries();
module.exports = {
  STATIC_BASE_URL,
  statesRegistry,
  charactersRegistry,
  refresh,
  sanitizeStatesRegistry,
  sanitizeCharactersRegistry
};

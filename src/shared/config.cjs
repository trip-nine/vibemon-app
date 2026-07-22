/** Shared configuration for VibeMon Local. */
const constants = require('./constants.cjs');
const characters = require('./characters.cjs');
const states = require('./states.cjs');
const { STATIC_BASE_URL } = require('./registry-cache.cjs');

module.exports = {
  ...constants,
  ...characters,
  ...states,
  // Remote relay and installer configuration are intentionally absent.
  WS_URL: null,
  WS_TOKEN: null,
  DOCS_BASE_URL: null,
  INSTALLER_SHA256: null,
  STATIC_BASE_URL,
  LOCAL_ONLY: true
};

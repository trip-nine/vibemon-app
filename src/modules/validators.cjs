/** Input validation for live status and agent observability fields. */
const { VALID_STATES } = require('../shared/config.cjs');

const LIMITS = {
  project: 128,
  tool: 64,
  model: 64,
  character: 64,
  terminalId: 100,
  identifier: 256,
  path: 2048,
  description: 4096,
  files: 200
};
const ITERM2_SESSION_PATTERN = /^iterm2:w\d+t\d+p\d+:[0-9A-Fa-f-]{36}$/;
const GHOSTTY_PID_PATTERN = /^ghostty:\d{1,10}$/;

function ok() { return { valid: true, error: null }; }
function fail(error) { return { valid: false, error }; }

function validateState(state) {
  if (state === undefined) return fail('state is required');
  return VALID_STATES.includes(state)
    ? ok()
    : fail(`Invalid state: ${state}. Valid states: ${VALID_STATES.join(', ')}`);
}

function validateOptionalString(value, label, max) {
  if (value === undefined || value === null || value === '') return ok();
  if (typeof value !== 'string') return fail(`${label} must be a string`);
  if (value.length > max) return fail(`${label} exceeds ${max} characters`);
  return ok();
}

function validateCharacter(value) { return validateOptionalString(value, 'Character name', LIMITS.character); }
function validateProject(value) { return validateOptionalString(value, 'Project name', LIMITS.project); }
function validateTool(value) { return validateOptionalString(value, 'Tool name', LIMITS.tool); }
function validateModel(value) { return validateOptionalString(value, 'Model name', LIMITS.model); }
function validateUsageLabel(value) { return validateOptionalString(value, 'usageWeekModelLabel', LIMITS.model); }

function validateMemory(memory) {
  if (memory === undefined || memory === null || memory === '') return ok();
  if (typeof memory !== 'number' || !Number.isFinite(memory)) {
    return fail('Memory must be a number');
  }
  if (!Number.isInteger(memory) || memory < 0 || memory > 100) {
    return fail('Memory must be an integer between 0 and 100');
  }
  return ok();
}

function validateUsage(value, label) {
  if (value === undefined || value === null || value === '') return ok();
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return fail(`${label} must be an integer between 0 and 100`);
  }
  return ok();
}

function validateResetMinutes(value, label) {
  if (value === undefined || value === null || value === '') return ok();
  if (!Number.isInteger(value) || value < 0) return fail(`${label} must be a non-negative integer`);
  return ok();
}

function validateNonNegativeNumber(value, label, integer = false) {
  if (value === undefined || value === null || value === '') return ok();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(`${label} must be a non-negative number`);
  }
  if (integer && !Number.isInteger(value)) return fail(`${label} must be an integer`);
  return ok();
}

function validateTerminalId(terminalId) {
  const base = validateOptionalString(terminalId, 'terminalId', LIMITS.terminalId);
  if (!base.valid || terminalId === undefined || terminalId === null || terminalId === '') return base;
  return ITERM2_SESSION_PATTERN.test(terminalId) || GHOSTTY_PID_PATTERN.test(terminalId)
    ? ok()
    : fail('terminalId must be a valid iTerm2 session ID or Ghostty PID');
}

function validateFiles(files) {
  if (files === undefined || files === null) return ok();
  if (!Array.isArray(files)) return fail('files must be an array');
  if (files.length > LIMITS.files) return fail(`files exceeds ${LIMITS.files} entries`);
  for (const file of files) {
    const result = validateOptionalString(file, 'file path', LIMITS.path);
    if (!result.valid) return result;
  }
  return ok();
}

function validateTimestamp(value) {
  if (value === undefined || value === null || value === '') return ok();
  if (typeof value === 'number' && Number.isFinite(value)) return ok();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return ok();
  return fail('timestamp must be an ISO date string or epoch milliseconds');
}

function validateStatusPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('Payload must be a JSON object');

  const checks = [
    validateState(data.state),
    validateCharacter(data.character),
    validateProject(data.project),
    validateMemory(data.memory),
    validateUsage(data.usage5h, 'usage5h'),
    validateUsage(data.usageWeek, 'usageWeek'),
    validateResetMinutes(data.usage5hResetsIn, 'usage5hResetsIn'),
    validateResetMinutes(data.usageWeekResetsIn, 'usageWeekResetsIn'),
    validateUsage(data.usageWeekModel, 'usageWeekModel'),
    validateResetMinutes(data.usageWeekModelResetsIn, 'usageWeekModelResetsIn'),
    validateUsageLabel(data.usageWeekModelLabel),
    validateTool(data.tool),
    validateModel(data.model),
    validateTerminalId(data.terminalId),
    validateTimestamp(data.timestamp),
    validateFiles(data.files)
  ];

  const stringFields = [
    ['eventType', LIMITS.identifier], ['sessionId', LIMITS.identifier],
    ['agentId', LIMITS.identifier], ['parentAgentId', LIMITS.identifier],
    ['agentName', LIMITS.identifier], ['agentType', LIMITS.identifier],
    ['teamId', LIMITS.identifier], ['taskId', LIMITS.identifier],
    ['toolUseId', LIMITS.identifier], ['modelSource', LIMITS.identifier],
    ['repo', LIMITS.path], ['branch', LIMITS.project], ['cwd', LIMITS.path],
    ['transcriptPath', LIMITS.path], ['description', LIMITS.description], ['error', LIMITS.description]
  ];
  for (const [field, max] of stringFields) checks.push(validateOptionalString(data[field], field, max));

  for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'durationMs']) {
    checks.push(validateNonNegativeNumber(data[field], field, true));
  }
  checks.push(validateNonNegativeNumber(data.costUsd, 'costUsd'));
  if (data.success !== undefined && typeof data.success !== 'boolean') checks.push(fail('success must be a boolean'));

  return checks.find(result => !result.valid) || ok();
}

module.exports = {
  validateState,
  validateCharacter,
  validateProject,
  validateMemory,
  validateUsage,
  validateResetMinutes,
  validateUsageLabel,
  validateTool,
  validateModel,
  validateTerminalId,
  validateStatusPayload,
  validateFiles,
  validateTimestamp
};

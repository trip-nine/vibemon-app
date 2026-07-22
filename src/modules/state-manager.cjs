/** State, timeout, and status payload normalization. */
const {
  IDLE_TIMEOUT_MS, SLEEP_TIMEOUT_MS, WINDOW_CLOSE_TIMEOUT_MS,
  CHARACTER_CONFIG, DEFAULT_CHARACTER
} = require('../shared/config.cjs');

const STATUS_FIELDS = [
  'state', 'project', 'tool', 'model', 'memory', 'usage5h', 'usageWeek',
  'usage5hResetsIn', 'usageWeekResetsIn', 'usageWeekModel',
  'usageWeekModelResetsIn', 'usageWeekModelLabel', 'character', 'terminalId',
  // Local historical observability fields.
  'timestamp', 'eventType', 'sessionId', 'agentId', 'parentAgentId', 'agentName',
  'agentType', 'teamId', 'taskId', 'toolUseId', 'modelSource', 'repo', 'branch',
  'cwd', 'transcriptPath', 'inputTokens', 'outputTokens', 'cacheReadTokens',
  'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'costUsd', 'durationMs',
  'success', 'error', 'description', 'files'
];

class StateManager {
  constructor() {
    this.stateTimeoutTimers = new Map();
    this.windowCloseTimers = new Map();
    this.onStateTimeout = null;
    this.onWindowCloseTimeout = null;
  }

  clearStateTimeout(projectId) {
    const timer = this.stateTimeoutTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.stateTimeoutTimers.delete(projectId);
  }

  clearWindowCloseTimer(projectId) {
    const timer = this.windowCloseTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.windowCloseTimers.delete(projectId);
  }

  setupWindowCloseTimer(projectId, currentState) {
    this.clearWindowCloseTimer(projectId);
    if (currentState === 'sleep' && this.onWindowCloseTimeout) {
      const timer = setTimeout(() => {
        this.windowCloseTimers.delete(projectId);
        this.onWindowCloseTimeout(projectId);
      }, WINDOW_CLOSE_TIMEOUT_MS);
      this.windowCloseTimers.set(projectId, timer);
    }
  }

  setupStateTimeout(projectId, currentState) {
    this.clearStateTimeout(projectId);
    this.clearWindowCloseTimer(projectId);
    let target = null;
    let timeout = null;
    if (currentState === 'start' || currentState === 'done') {
      target = 'idle'; timeout = IDLE_TIMEOUT_MS;
    } else if (['planning', 'thinking', 'working', 'packing', 'notification', 'alert'].includes(currentState)) {
      target = 'idle'; timeout = SLEEP_TIMEOUT_MS;
    } else if (currentState === 'idle') {
      target = 'sleep'; timeout = SLEEP_TIMEOUT_MS;
    } else if (currentState === 'sleep') {
      this.setupWindowCloseTimer(projectId, currentState);
      return;
    }
    if (target && timeout !== null) {
      const timer = setTimeout(() => {
        this.stateTimeoutTimers.delete(projectId);
        if (this.onStateTimeout) this.onStateTimeout(projectId, target);
      }, timeout);
      this.stateTimeoutTimers.set(projectId, timer);
    }
  }

  validateStateData(data) {
    if (!data || typeof data !== 'object') return { valid: false, error: 'Invalid data format' };
    const normalized = Object.fromEntries(
      STATUS_FIELDS.filter(field => data[field] !== undefined).map(field => [field, data[field]])
    );
    if (normalized.project === '' || normalized.project === '-') delete normalized.project;
    if (normalized.character !== undefined) {
      normalized.character = CHARACTER_CONFIG[normalized.character] ? normalized.character : DEFAULT_CHARACTER;
    }
    return { valid: true, data: normalized };
  }

  cleanupProject(projectId) {
    this.clearStateTimeout(projectId);
    this.clearWindowCloseTimer(projectId);
  }

  cleanup() {
    for (const timer of this.stateTimeoutTimers.values()) clearTimeout(timer);
    for (const timer of this.windowCloseTimers.values()) clearTimeout(timer);
    this.stateTimeoutTimers.clear();
    this.windowCloseTimers.clear();
  }
}

module.exports = { StateManager, STATUS_FIELDS };

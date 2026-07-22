/**
 * Durable, local-only event ledger for AI coding sessions.
 *
 * Events are partitioned by month as JSONL under Electron userData/history.
 * JSONL keeps the recorder dependency-free, append-only, inspectable, and easy
 * to import into SQLite/DuckDB later without changing the ingestion contract.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_IN_MEMORY_EVENTS = 250000;
const MAX_STRING = 4096;
const MAX_FILES = 200;

function cleanString(value, max = MAX_STRING) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanInteger(value) {
  const number = cleanNumber(value);
  return number === null ? null : Math.round(number);
}

function firstValue(data, names) {
  for (const name of names) {
    if (data[name] !== undefined && data[name] !== null && data[name] !== '') return data[name];
  }
  return null;
}

function cleanFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FILES).map(item => cleanString(item, 1024)).filter(Boolean);
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function monthKey(isoTimestamp) {
  return isoTimestamp.slice(0, 7);
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

class EventStore {
  constructor(app, options = {}) {
    this.baseDir = options.baseDir || path.join(app.getPath('userData'), 'history');
    this.maxInMemoryEvents = options.maxInMemoryEvents || MAX_IN_MEMORY_EVENTS;
    this.events = [];
    this.loaded = false;
    this.ensureDirectory();
    this.load();
  }

  ensureDirectory() {
    fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.baseDir, 0o700); } catch { /* best effort */ }
  }

  listEventFiles() {
    return fs.readdirSync(this.baseDir)
      .filter(name => /^events-\d{4}-\d{2}\.jsonl$/.test(name))
      .sort()
      .map(name => path.join(this.baseDir, name));
  }

  load() {
    if (this.loaded) return;
    const loaded = [];
    for (const file of this.listEventFiles()) {
      let body = '';
      try { body = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        try { loaded.push(JSON.parse(line)); } catch { /* skip damaged line */ }
      }
    }
    this.events = loaded.slice(-this.maxInMemoryEvents);
    this.loaded = true;
  }

  normalize(data, meta = {}) {
    const timestamp = normalizeTimestamp(firstValue(data, ['timestamp', 'createdAt', 'created_at']));
    const inputTokens = cleanInteger(firstValue(data, ['inputTokens', 'input_tokens']));
    const outputTokens = cleanInteger(firstValue(data, ['outputTokens', 'output_tokens']));
    const cacheReadTokens = cleanInteger(firstValue(data, ['cacheReadTokens', 'cache_read_tokens']));
    const cacheWriteTokens = cleanInteger(firstValue(data, ['cacheWriteTokens', 'cache_write_tokens']));
    const reasoningTokens = cleanInteger(firstValue(data, ['reasoningTokens', 'reasoning_tokens']));
    const suppliedTotal = cleanInteger(firstValue(data, ['totalTokens', 'total_tokens', 'billedTokens', 'billed_tokens']));
    const computedTotal = sum([inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens]);

    const event = {
      id: cleanString(data.id, 160) || crypto.randomUUID(),
      timestamp,
      source: cleanString(meta.source || data.source, 64) || 'local',
      eventType: cleanString(firstValue(data, ['eventType', 'event_type']), 96) ||
        (data.state ? 'status' : 'agent-event'),
      project: cleanString(data.project, 256),
      repo: cleanString(firstValue(data, ['repo', 'repository']), 512),
      branch: cleanString(data.branch, 256),
      cwd: cleanString(firstValue(data, ['cwd', 'workingDirectory', 'working_directory']), 2048),
      sessionId: cleanString(firstValue(data, ['sessionId', 'session_id']), 256),
      agentId: cleanString(firstValue(data, ['agentId', 'agent_id', 'subagentId', 'subagent_id']), 256),
      parentAgentId: cleanString(firstValue(data, ['parentAgentId', 'parent_agent_id']), 256),
      agentName: cleanString(firstValue(data, ['agentName', 'agent_name']), 256),
      agentType: cleanString(firstValue(data, ['agentType', 'agent_type']), 128),
      teamId: cleanString(firstValue(data, ['teamId', 'team_id']), 256),
      taskId: cleanString(firstValue(data, ['taskId', 'task_id']), 256),
      toolUseId: cleanString(firstValue(data, ['toolUseId', 'tool_use_id']), 256),
      transcriptPath: cleanString(firstValue(data, ['transcriptPath', 'transcript_path']), 2048),
      state: cleanString(data.state, 64),
      tool: cleanString(data.tool, 128),
      model: cleanString(firstValue(data, ['model', 'resolvedModel', 'resolved_model']), 256),
      modelSource: cleanString(firstValue(data, ['modelSource', 'model_source']), 64),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      totalTokens: suppliedTotal === null ? computedTotal : suppliedTotal,
      costUsd: cleanNumber(firstValue(data, ['costUsd', 'cost_usd', 'reportedCostUsd'])),
      durationMs: cleanInteger(firstValue(data, ['durationMs', 'duration_ms'])),
      success: typeof data.success === 'boolean' ? data.success : null,
      error: cleanString(data.error, 4096),
      description: cleanString(firstValue(data, ['description', 'summary', 'message']), 4096),
      files: cleanFiles(firstValue(data, ['files', 'filesTouched', 'files_touched']))
    };

    // Main sessions may not have an explicit agent id. Giving them a stable
    // synthetic identity allows the lineage view to place subagents beneath it.
    if (!event.agentId && event.sessionId) event.agentId = `session:${event.sessionId}`;
    return event;
  }

  record(data, meta = {}) {
    const event = this.normalize(data, meta);
    const file = path.join(this.baseDir, `events-${monthKey(event.timestamp)}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.splice(0, this.events.length - this.maxInMemoryEvents);
    }
    return event;
  }

  recordMany(items, meta = {}) {
    if (!Array.isArray(items)) return [this.record(items, meta)];
    return items.slice(0, 500).map(item => this.record(item, meta));
  }

  filterEvents(filters = {}) {
    const since = filters.since ? Date.parse(filters.since) : null;
    return this.events.filter(event => {
      if (filters.project && event.project !== filters.project) return false;
      if (filters.sessionId && event.sessionId !== filters.sessionId) return false;
      if (filters.agentId && event.agentId !== filters.agentId) return false;
      if (filters.model && event.model !== filters.model) return false;
      if (filters.eventType && event.eventType !== filters.eventType) return false;
      if (since && Date.parse(event.timestamp) < since) return false;
      return true;
    });
  }

  query(filters = {}) {
    const limit = Math.max(1, Math.min(Number(filters.limit) || 250, 5000));
    return this.filterEvents(filters).slice(-limit).reverse();
  }

  summary(filters = {}) {
    const events = this.filterEvents(filters);
    const sessions = new Set();
    const agents = new Set();
    const projects = new Set();
    const models = new Map();
    const tools = new Map();

    for (const event of events) {
      if (event.sessionId) sessions.add(event.sessionId);
      if (event.agentId) agents.add(event.agentId);
      if (event.project) projects.add(event.project);
      if (event.model) {
        const current = models.get(event.model) || { model: event.model, events: 0, agents: new Set(), tokens: 0, costUsd: 0 };
        current.events += 1;
        if (event.agentId) current.agents.add(event.agentId);
        current.tokens += event.totalTokens || 0;
        current.costUsd += event.costUsd || 0;
        models.set(event.model, current);
      }
      if (event.tool) tools.set(event.tool, (tools.get(event.tool) || 0) + 1);
    }

    return {
      events: events.length,
      sessions: sessions.size,
      agents: agents.size,
      projects: projects.size,
      totalTokens: sum(events.map(event => event.totalTokens)),
      inputTokens: sum(events.map(event => event.inputTokens)),
      outputTokens: sum(events.map(event => event.outputTokens)),
      cacheReadTokens: sum(events.map(event => event.cacheReadTokens)),
      cacheWriteTokens: sum(events.map(event => event.cacheWriteTokens)),
      reasoningTokens: sum(events.map(event => event.reasoningTokens)),
      reportedCostUsd: Number(sum(events.map(event => event.costUsd)).toFixed(6)),
      totalDurationMs: sum(events.map(event => event.durationMs)),
      models: [...models.values()].map(item => ({
        model: item.model,
        events: item.events,
        agents: item.agents.size,
        tokens: item.tokens,
        reportedCostUsd: Number(item.costUsd.toFixed(6))
      })).sort((a, b) => b.tokens - a.tokens || b.events - a.events),
      tools: [...tools.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count),
      storage: this.getStorageInfo()
    };
  }

  agentTree(sessionId) {
    const events = this.events.filter(event => !sessionId || event.sessionId === sessionId);
    const nodes = new Map();

    for (const event of events) {
      if (!event.agentId) continue;
      const node = nodes.get(event.agentId) || {
        agentId: event.agentId,
        parentAgentId: event.parentAgentId,
        sessionId: event.sessionId,
        agentName: event.agentName,
        agentType: event.agentType,
        model: event.model,
        events: 0,
        tokens: 0,
        reportedCostUsd: 0,
        startedAt: event.timestamp,
        lastSeenAt: event.timestamp,
        states: new Set(),
        tools: new Set()
      };
      node.parentAgentId = event.parentAgentId || node.parentAgentId;
      node.agentName = event.agentName || node.agentName;
      node.agentType = event.agentType || node.agentType;
      node.model = event.model || node.model;
      node.events += 1;
      node.tokens += event.totalTokens || 0;
      node.reportedCostUsd += event.costUsd || 0;
      if (event.timestamp < node.startedAt) node.startedAt = event.timestamp;
      if (event.timestamp > node.lastSeenAt) node.lastSeenAt = event.timestamp;
      if (event.state) node.states.add(event.state);
      if (event.tool) node.tools.add(event.tool);
      nodes.set(event.agentId, node);
    }

    return [...nodes.values()].map(node => ({
      ...node,
      states: [...node.states],
      tools: [...node.tools],
      reportedCostUsd: Number(node.reportedCostUsd.toFixed(6))
    })).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  getStorageInfo() {
    const files = this.listEventFiles();
    let bytes = 0;
    for (const file of files) {
      try { bytes += fs.statSync(file).size; } catch { /* ignore */ }
    }
    return {
      directory: this.baseDir,
      files: files.length,
      bytes,
      inMemoryEvents: this.events.length,
      format: 'jsonl-v1'
    };
  }

  close() {}
}

module.exports = { EventStore, normalizeTimestamp };

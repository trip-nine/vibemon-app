/**
 * Loopback-only HTTP API and historical analytics server.
 */

const http = require('http');
const { URL } = require('url');
const fsPromises = require('fs').promises;
const path = require('path');
const { HTTP_PORT, MAX_PAYLOAD_SIZE, RATE_LIMIT, RATE_WINDOW_MS, CHARACTER_NAMES } = require('../shared/config.cjs');
const { setCorsHeaders, isAllowedOrigin, hasJsonContentType, sendJson, sendError, parseJsonBody } = require('./http-utils.cjs');
const { validateStatusPayload } = require('./validators.cjs');
const { EventStore } = require('./event-store.cjs');
const { RuntimeScanner } = require('./runtime-scanner.cjs');
const { RuntimeMonitor } = require('./runtime-monitor.cjs');
const { installLocalOnlyGuard } = require('./local-only-guard.cjs');

if (!process.env.JEST_WORKER_ID) installLocalOnlyGuard();

const RATE_CLEANUP_THRESHOLD = 100;

class HttpServer {
  constructor(stateManager, windowManager, app) {
    this.server = null;
    this.stateManager = stateManager;
    this.windowManager = windowManager;
    this.app = app;
    this.eventStore = new EventStore(app);
    this.runtimeScanner = new RuntimeScanner();
    this.runtimeMonitor = new RuntimeMonitor(app, { scanner: this.runtimeScanner });
    this.hookInstaller = null;
    this.onStateUpdate = null;
    this.onProjectSwitched = null;
    this.onError = null;
    this.requestCounts = new Map();
  }

  setHookInstaller(hookInstaller) {
    this.hookInstaller = hookInstaller;
  }

  cleanupExpiredRateLimits() {
    const now = Date.now();
    for (const [ip, record] of this.requestCounts) {
      if (now > record.resetTime) this.requestCounts.delete(ip);
    }
  }

  checkRateLimit(ip) {
    if (this.requestCounts.size > RATE_CLEANUP_THRESHOLD) this.cleanupExpiredRateLimits();
    const now = Date.now();
    const record = this.requestCounts.get(ip);
    if (!record || now > record.resetTime) {
      this.requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
      return true;
    }
    if (record.count >= RATE_LIMIT) return false;
    record.count += 1;
    return true;
  }

  start() {
    this.runtimeMonitor.start();
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('Unhandled request error:', err.message);
        if (!res.headersSent) sendError(res, 500, 'Internal server error');
      });
    });
    this.server.on('error', (err) => {
      console.error('HTTP Server error:', err.message);
      if (this.onError) this.onError(err);
    });
    this.server.listen(HTTP_PORT, '127.0.0.1', () => {
      console.log(`VibeMon Local running on http://127.0.0.1:${HTTP_PORT}`);
    });
    return this.server;
  }

  stop() {
    this.requestCounts.clear();
    this.eventStore.close();
    this.runtimeMonitor.stop();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      const timeout = setTimeout(resolve, 5000);
      this.server.close(() => {
        clearTimeout(timeout);
        this.server = null;
        resolve();
      });
    });
  }

  async handleRequest(req, res) {
    if (!isAllowedOrigin(req)) return sendError(res, 403, 'Origin not allowed');
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    const ip = req.socket.remoteAddress || '127.0.0.1';
    if (!this.checkRateLimit(ip)) return sendError(res, 429, 'Too many requests');

    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const route = `${req.method} ${parsedUrl.pathname}`;

    switch (route) {
      case 'GET /': return this.handleGetDashboard(res);
      case 'GET /dashboard-data': return this.handleGetDashboardData(res);
      case 'POST /status': return this.handlePostStatus(req, res);
      case 'GET /status': return this.handleGetStatus(res);
      case 'POST /events': return this.handlePostEvents(req, res);
      case 'GET /history': return this.handleGetHistory(parsedUrl, res);
      case 'GET /history/summary': return this.handleGetHistorySummary(parsedUrl, res);
      case 'GET /history/agents': return this.handleGetAgentTree(parsedUrl, res);
      case 'GET /history/storage': return sendJson(res, 200, this.eventStore.getStorageInfo());
      case 'GET /runtimes': return this.handleGetRuntimes(res);
      case 'GET /runtimes/catalog': return this.handleGetRuntimeCatalog(res);
      case 'GET /runtimes/history': return this.handleGetRuntimeHistory(parsedUrl, res);
      case 'GET /runtimes/summary': return this.handleGetRuntimeSummary(parsedUrl, res);
      case 'GET /integrations': return this.handleGetIntegrations(res);
      case 'POST /integrations/install': return this.handleInstallIntegration(req, res);
      case 'POST /close': return this.handlePostClose(req, res);
      case 'GET /health': return this.handleGetHealth(res);
      case 'POST /show': return this.handlePostShow(req, res);
      case 'GET /debug': return this.handleGetDebug(res);
      case 'POST /quit': return this.handlePostQuit(res);
      case 'GET /character-lock': return this.handleGetCharacterLock(res);
      case 'POST /character-lock': return this.handlePostCharacterLock(req, res);
      default:
        res.writeHead(404);
        return res.end('Not Found');
    }
  }

  handleGetRuntimes(res) {
    return sendJson(res, 200, this.runtimeMonitor.current());
  }

  handleGetRuntimeCatalog(res) {
    return sendJson(res, 200, this.runtimeMonitor.scanner.catalog());
  }

  runtimeFilters(url) {
    return {
      since: url.searchParams.get('since') || undefined,
      limit: url.searchParams.get('limit') || undefined
    };
  }

  handleGetRuntimeHistory(url, res) {
    const filters = this.runtimeFilters(url);
    return sendJson(res, 200, { snapshots: this.runtimeMonitor.query(filters), filters });
  }

  handleGetRuntimeSummary(url, res) {
    return sendJson(res, 200, this.runtimeMonitor.summary(this.runtimeFilters(url)));
  }

  integrationView() {
    const snapshot = this.runtimeMonitor.current();
    const running = new Set((snapshot.processes || []).map(process => process.runtime));
    const installed = this.hookInstaller ? this.hookInstaller.refreshStatuses().map(tool => ({
      name: tool.name,
      flag: tool.flag,
      present: Boolean(tool.present),
      hasHook: Boolean(tool.hasHook),
      installAvailable: Boolean(tool.installAvailable),
      requiresTrust: Boolean(tool.requiresTrust),
      localOnly: true,
      state: tool.hasHook ? 'installed' : 'pending'
    })) : [];
    return [
      ...installed,
      {
        name: 'LM Studio local models', flag: '--lm-studio',
        present: running.has('LM Studio'), hasHook: Boolean(snapshot.lmStudio && snapshot.lmStudio.available),
        installAvailable: false, localOnly: true,
        state: snapshot.lmStudio && snapshot.lmStudio.available ? 'connected' : 'observed',
        detail: snapshot.lmStudio && snapshot.lmStudio.available
          ? 'Local model inventory connected automatically'
          : 'Process resources are observed; start LM Studio to connect its local CLI'
      },
      {
        name: 'VS Code / Cursor companion', flag: '--editor-companion',
        present: running.has('VS Code') || running.has('Cursor'), hasHook: false,
        installAvailable: false, localOnly: true, state: 'available',
        detail: 'Optional companion source is bundled under integrations/vscode-vibemon'
      },
      {
        name: 'Antigravity workspace hook', flag: '--antigravity',
        present: running.has('Antigravity'), hasHook: false,
        installAvailable: false, localOnly: true, state: 'available',
        detail: 'Install per project: npm run install:antigravity-hooks -- /workspace/path'
      },
      {
        name: 'Claude Desktop', flag: '--claude-desktop',
        present: running.has('Claude'), hasHook: false,
        installAvailable: false, localOnly: true, state: 'observed',
        detail: 'Process/resource presence only; no supported passive chat lifecycle interface'
      }
    ];
  }

  handleGetIntegrations(res) {
    return sendJson(res, 200, { integrations: this.integrationView() });
  }

  async handleInstallIntegration(req, res) {
    const data = await this.readJson(req, res);
    if (data === null) return;
    const flag = data && typeof data.flag === 'string' ? data.flag : '';
    if (!this.hookInstaller || !['--claude', '--codex'].includes(flag)) {
      return sendError(res, 400, 'A supported integration flag is required');
    }
    const results = await this.hookInstaller.installByFlag(flag);
    const result = results[0] ? results[0].result : { ok: false, reason: 'not-found' };
    return sendJson(res, result.ok ? 200 : 500, {
      result: {
        ok: Boolean(result.ok),
        changed: Boolean(result.changed),
        requiresTrust: Boolean(result.requiresTrust),
        trustInstructions: result.trustInstructions || null,
        reason: result.reason || null
      },
      integrations: this.integrationView()
    });
  }

  async readJson(req, res) {
    if (!hasJsonContentType(req)) {
      sendError(res, 415, 'Content-Type must be application/json');
      return null;
    }
    const parsed = await parseJsonBody(req, MAX_PAYLOAD_SIZE);
    if (parsed.error) {
      sendError(res, parsed.statusCode, parsed.error);
      return null;
    }
    return parsed.data;
  }

  async handlePostEvents(req, res) {
    const data = await this.readJson(req, res);
    if (data === null) return;
    if ((!Array.isArray(data) && (!data || typeof data !== 'object')) ||
        (Array.isArray(data) && data.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
      return sendError(res, 400, 'Event payload must be an object or array of objects');
    }
    const recorded = this.eventStore.recordMany(data, { source: 'events-api' });
    return sendJson(res, 201, { success: true, recorded: recorded.length, events: recorded });
  }

  async handlePostStatus(req, res) {
    const data = await this.readJson(req, res);
    if (data === null) return;
    const validation = validateStatusPayload(data);
    if (!validation.valid) return sendError(res, 400, validation.error);

    const stateValidation = this.stateManager.validateStateData(data);
    if (!stateValidation.valid) return sendError(res, 400, stateValidation.error || 'Invalid state data');
    const stateData = stateValidation.data;
    const recorded = this.eventStore.record(stateData, { source: 'status-api' });

    if (!stateData.project) {
      return sendJson(res, 200, {
        success: true,
        eventId: recorded.id,
        project: null,
        state: stateData.state,
        focusedProject: this.windowManager.getFocusedProjectId(),
        skipped: true
      });
    }

    const projectId = stateData.project;
    const routeResult = this.windowManager.routeStatusUpdate(projectId, stateData);
    if (routeResult.switchedProject && this.onProjectSwitched) {
      this.onProjectSwitched(routeResult.switchedProject);
    }

    const updateResult = routeResult.updateResult;
    this.stateManager.setupStateTimeout(projectId, stateData.state);
    if (updateResult.updated) {
      if (updateResult.stateChanged) {
        this.windowManager.updateAlwaysOnTopByState(stateData.state);
        if (this.onStateUpdate) this.onStateUpdate(false);
      }
      this.windowManager.sendToWindow(projectId, 'state-update', routeResult.stateData);
    }

    return sendJson(res, 200, {
      success: true,
      eventId: recorded.id,
      project: projectId,
      state: stateData.state,
      focusedProject: this.windowManager.getFocusedProjectId(),
      skipped: !updateResult.updated
    });
  }

  historyFilters(url) {
    return {
      project: url.searchParams.get('project') || undefined,
      sessionId: url.searchParams.get('sessionId') || undefined,
      agentId: url.searchParams.get('agentId') || undefined,
      model: url.searchParams.get('model') || undefined,
      eventType: url.searchParams.get('eventType') || undefined,
      since: url.searchParams.get('since') || undefined,
      limit: url.searchParams.get('limit') || undefined
    };
  }

  handleGetHistory(url, res) {
    const filters = this.historyFilters(url);
    return sendJson(res, 200, { events: this.eventStore.query(filters), filters });
  }

  handleGetHistorySummary(url, res) {
    return sendJson(res, 200, this.eventStore.summary(this.historyFilters(url)));
  }

  handleGetAgentTree(url, res) {
    const filters = this.historyFilters(url);
    return sendJson(res, 200, { filters, agents: this.eventStore.agentTree(filters) });
  }

  handleGetStatus(res) {
    return sendJson(res, 200, {
      focusedProject: this.windowManager.getFocusedProjectId(),
      projects: this.windowManager.getRegisteredStates()
    });
  }

  async handlePostClose(req, res) {
    const data = await this.readJson(req, res);
    if (data === null) return;
    if (!data.project) return sendError(res, 400, 'Project is required');
    const closed = this.windowManager.closeWindow(data.project);
    if (closed && this.onStateUpdate) this.onStateUpdate(true);
    return sendJson(res, 200, { success: closed, project: data.project });
  }

  handleGetHealth(res) {
    return sendJson(res, 200, {
      status: 'ok',
      mode: 'local-only',
      storage: this.eventStore.getStorageInfo()
    });
  }

  async handlePostShow(req, res) {
    let data = {};
    if (req.headers['content-length']) {
      data = await this.readJson(req, res);
      if (data === null) return;
    }
    const shown = data.project
      ? this.windowManager.showWindow(data.project)
      : this.windowManager.showActiveWindow();
    return sendJson(res, 200, {
      success: shown,
      project: data.project || this.windowManager.getFocusedProjectId()
    });
  }

  handleGetDebug(res) {
    return sendJson(res, 200, {
      ...this.windowManager.getDebugInfo(),
      history: this.eventStore.getStorageInfo(),
      localOnly: true
    });
  }

  handlePostQuit(res) {
    sendJson(res, 200, { success: true });
    setTimeout(() => this.app.quit(), 100);
  }

  handleGetCharacterLock(res) {
    return sendJson(res, 200, { character: this.windowManager.getCharacterLock() });
  }

  async handlePostCharacterLock(req, res) {
    const data = await this.readJson(req, res);
    if (data === null) return;
    const character = data.character;
    if (!character) return sendError(res, 400, 'Character is required');
    if (character !== 'auto' && !CHARACTER_NAMES.includes(character)) {
      return sendJson(res, 200, {
        success: false,
        error: `Invalid character: ${character}`,
        validCharacters: ['auto', ...CHARACTER_NAMES]
      });
    }
    this.windowManager.setCharacterLock(character);
    if (this.onStateUpdate) this.onStateUpdate(true);
    return sendJson(res, 200, { success: true, character });
  }

  handleGetDashboardData(res) {
    const focusedProject = this.windowManager.getFocusedProjectId();
    const projects = Object.entries(this.windowManager.getRegisteredStates()).map(([projectId, state]) => ({
      project: projectId,
      state: state ? state.state : 'unknown',
      focused: projectId === focusedProject,
      model: state ? state.model || null : null,
      sessionId: state ? state.sessionId || null : null,
      agentId: state ? state.agentId || null : null
    }));
    return sendJson(res, 200, {
      health: 'ok',
      mode: 'local-only',
      version: this.app.getVersion(),
      focusedProject,
      characterLock: this.windowManager.getCharacterLock(),
      projects,
      history: this.eventStore.summary({ limit: 5000 })
    });
  }

  async handleGetDashboard(res) {
    const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
    try {
      const html = await fsPromises.readFile(dashboardPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"
      });
      res.end(html);
    } catch (err) {
      console.error('Failed to load dashboard page:', err.message);
      sendError(res, 500, 'Failed to load dashboard page');
    }
  }
}

module.exports = { HttpServer };

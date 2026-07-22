const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventStore } = require('../src/modules/event-store.cjs');

describe('EventStore', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibemon-events-'));
    store = new EventStore({ getPath: () => dir }, { baseDir: dir });
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('persists model, agent lineage, tokens, and cost', () => {
    store.record({
      eventType: 'subagent.completed', sessionId: 's1', agentId: 'a2', parentAgentId: 'a1',
      project: 'demo', model: 'claude-opus', inputTokens: 100, outputTokens: 25,
      costUsd: 0.42, success: true
    });
    const event = store.query({ sessionId: 's1' })[0];
    expect(event).toMatchObject({ agentId: 'a2', parentAgentId: 'a1', model: 'claude-opus', totalTokens: 125 });
    expect(store.summary({ sessionId: 's1' })).toMatchObject({ agents: 1, sessions: 1, totalTokens: 125, reportedCostUsd: 0.42 });
  });

  test('builds an agent tree with per-agent totals', () => {
    store.record({ sessionId: 's1', agentId: 'a1', model: 'sonnet', totalTokens: 10 });
    store.record({ sessionId: 's1', agentId: 'a2', parentAgentId: 'a1', model: 'opus', totalTokens: 20 });
    const tree = store.agentTree('s1');
    expect(tree).toHaveLength(2);
    expect(tree.find(agent => agent.agentId === 'a2').parentAgentId).toBe('a1');
  });
});

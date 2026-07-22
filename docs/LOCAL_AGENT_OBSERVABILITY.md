# VibeMon Local Agent Observability

VibeMon Local is an append-only, loopback-only flight recorder for AI coding agents. It preserves the existing live character monitor while adding historical events, model attribution, token/cost accounting, and parent/child agent lineage.

## Security boundary

- The desktop collector binds only to `127.0.0.1:19280`.
- Cloud WebSockets, remote registries, remote sprites, auto-updates, remote hook installers, and provider usage refreshes are disabled.
- `~/.vibemon/config.json` is continuously normalized to loopback HTTP destinations only; cloud URL/token values are erased.
- The Electron process installs an outbound guard covering `fetch`, HTTP(S), TCP, and TLS. Non-loopback connections throw `VIBEMON_LOCAL_ONLY`.
- Historical files are owner-only JSONL under Electron's `userData/history` directory.

## Install the Claude Code adapter

From the repository root:

```bash
npm run install:local-hooks
```

This copies the reviewed, bundled adapter to `~/.vibemon/hooks/claude.py` and merges lifecycle hooks into `~/.claude/settings.json`. It does not download or execute remote code. The adapter records metadata only; it intentionally excludes prompt bodies, assistant messages, source-code contents, and tool-output bodies.

## Event ingestion

Existing status hooks continue to use:

```http
POST http://127.0.0.1:19280/status
Content-Type: application/json
```

Rich lifecycle events can use:

```http
POST http://127.0.0.1:19280/events
Content-Type: application/json
```

`/events` accepts one object or an array of up to 500 objects.

### Recommended Claude Code event envelope

```json
{
  "timestamp": "2026-07-21T23:10:00.000Z",
  "eventType": "subagent.completed",
  "project": "cuepilot",
  "repo": "trip-nine/cuepilot",
  "branch": "agent/clicky-integration",
  "cwd": "/Users/trip/code/cuepilot",
  "sessionId": "claude-session-uuid",
  "agentId": "agent-uuid",
  "parentAgentId": "parent-agent-uuid",
  "agentName": "security-reviewer",
  "agentType": "Explore",
  "teamId": "experiment-team-7",
  "taskId": "task-42",
  "toolUseId": "toolu_...",
  "transcriptPath": "/local/path/to/subagent/transcript.jsonl",
  "model": "claude-opus-4-1",
  "modelSource": "resolved",
  "inputTokens": 125000,
  "outputTokens": 8300,
  "cacheReadTokens": 41000,
  "cacheWriteTokens": 12000,
  "reasoningTokens": 0,
  "totalTokens": 186300,
  "costUsd": 8.41,
  "durationMs": 281000,
  "success": true,
  "files": ["src/auth.ts", "src/policy.ts"],
  "description": "Reviewed authentication and proposed two patches"
}
```

All fields are optional on `/events`. `/status` still requires a valid live `state`.

## Historical API

- `GET /history?limit=500&project=&sessionId=&agentId=&model=&eventType=&since=`
- `GET /history/summary?project=&sessionId=&model=&since=`
- `GET /history/agents?sessionId=`
- `GET /history/storage`
- `GET /dashboard-data`

The dashboard at `http://127.0.0.1:19280/` shows:

- sessions, agents, events, tokens, and reported cost;
- model use per agent and across the project;
- parent/child subagent lineage;
- event replay timeline;
- local storage location and size.

## Model and cost attribution

VibeMon records the model actually reported by the hook or Agent tool response. Collectors should prefer the resolved model rather than the requested alias and set `modelSource` to values such as `resolved`, `explicit`, `inherited`, `fallback`, or `unknown`.

Cost is deliberately not inferred from a hard-coded cloud price table. Send `costUsd` when the provider or local billing adapter can calculate it. This avoids silently producing stale or misleading estimates.

## Storage evolution

The on-disk contract is intentionally append-only JSONL (`jsonl-v1`). A future SQLite/DuckDB index can ingest these files without changing collectors. Recommended next steps:

1. Claude Code hook adapter that extracts session/subagent IDs, resolved models, transcript paths, token totals, and Agent tool results.
2. SQLite operational index and DuckDB analytical views over the JSONL source of truth.
3. Git commit/file attribution and experimental run comparison.
4. Local embeddings and semantic search across event descriptions and transcript references.
5. Flame graphs, Gantt views, concurrency saturation, cache efficiency, failed-agent loops, and budget alerts.

# VibeMon Local

**Local-only AI runtime monitor and historical agent operations recorder.**

VibeMon Local combines privacy-preserving process/resource observation with
high-fidelity adapters where a runtime exposes supported hooks or a local API.
It stores everything on this computer and rejects non-loopback network traffic.

## Integration model

| Agent | Bridge type | Tool visibility | Notes |
|------|-------------|-----------------|-------|
| Claude Code CLI | Bundled local lifecycle hooks | Broad | Install from the dashboard or Settings |
| Codex CLI | Bundled local lifecycle hooks | Broad | Install, then approve with `/hooks` in a new Codex session |
| Claude Desktop | Process tree + CPU/RAM/uptime | Presence | No supported passive lifecycle stream is exposed to VibeMon |
| Codex desktop app | Process tree + CPU/RAM/uptime | Presence | CLI hooks do not observe unrelated desktop tasks |
| LM Studio | Process resources + local `lms ps --json` | Loaded models | Records model metadata, never prompts/responses |
| Cursor / VS Code | Process resources + optional companion extension | Workspace activity | Cannot inspect another extension's private AI chat or token stream |
| Antigravity | Process resources + documented workspace `PreToolUse` hook | Partial tool activity | Install per workspace; current reviewed hook observes `run_command` |
| Hermes / Grok / Goose / Kimi / Gemini / OpenClaw | Installed-state catalog + process/resource discovery | Presence and local event API | Structured model/token/agent data requires a product hook or event emitter |
| OpenRouter | Provider/event attribution | Events supplied locally | It is a cloud provider, not a local process; VibeMon never polls its cloud API |
| Kiro / Windsurf / Ollama / Aider / OpenCode / Qwen Code / Crush / Amp / OpenHands | Installed-state catalog + process/resource discovery | Presence | Higher-fidelity adapters remain product-specific work |

### Support Quality

- **Claude Code CLI**: Bundled adapter records lifecycle, tools, models, and subagent metadata.
- **Codex CLI**: Bundled adapter uses Codex lifecycle hooks. Codex requires reviewing and trusting new hooks with `/hooks`.
- **Desktop apps and IDEs**: Process trees, CPU, RAM, process counts, and uptime are sampled into owner-only local history.
- **LM Studio**: Loaded model identity, size, quantization, context, and state are read from its local CLI.
- **VS Code / Cursor**: The companion extension records workspace, terminal, task, and save lifecycle metadata.
- **Antigravity**: A workspace installer merges the documented local hook without replacing existing hooks.
- **Emerging CLIs**: The coverage catalog shows supported, installed, running, and event-attributed states separately.
- **Kiro / OpenClaw**: Listed honestly as adapter-pending until reviewed local bridges are bundled.

## What It Monitors

| Field | Description | Example |
|-------|-------------|---------|
| **State** | Current activity state | `working`, `idle`, `notification` |
| **Project** | Active project directory | `vibemon-app` |
| **Tool** | Currently executing tool | `Bash`, `Read`, `Edit` |
| **Model** | Active model | `Opus`, `Sonnet` |
| **Memory** | Context window usage | `45%` |

## Quick Start

From this fork:

```bash
npm install
npm start
```

That's it! The app launches in the system tray and listens on `http://127.0.0.1:19280`.

`vibemon --version` prints the installed version, `vibemon --help` prints usage — both exit without launching the app.

Use the **Telemetry adapters** panel in the dashboard, or open **Settings > AI Tools**, to install the bundled Claude Code and Codex CLI adapters. Restart existing Claude Code terminals after installation. For Codex, start a new session, run `/hooks`, and trust the VibeMon Local hooks.

For an Antigravity workspace:

```bash
npm run install:antigravity-hooks -- /absolute/path/to/workspace
```

The VS Code/Cursor companion source is under
`integrations/vscode-vibemon`. Its README explains local development install.

### Add another runtime without rebuilding

Create `~/.vibemon/runtime-signatures.json`:

```json
{
  "signatures": [
    {
      "runtime": "My Agent",
      "surface": "CLI",
      "telemetry": "event-api",
      "executables": ["my-agent"],
      "pathContains": ["/.my-agent/"]
    }
  ]
}
```

VibeMon reloads the file during process sampling. Custom definitions are shown
in the Runtime coverage panel and are validated before use.

## Preview

![VibeMon Demo](images/demo.gif)

## Documentation

- [Features](docs/features.md) - States, animations, character window behavior
- [API Reference](docs/api.md) - Complete HTTP API documentation

For full documentation, visit **[vibemon.io/docs](https://vibemon.io/docs)**.

## States

| State | Color | Description |
|-------|-------|-------------|
| `start` | Cyan | Session begins |
| `idle` | Green | Waiting for input |
| `thinking` | Purple | Processing prompt |
| `planning` | Teal | Plan mode active |
| `working` | Blue | Tool executing |
| `packing` | Gray | Context compacting |
| `notification` | Yellow | User input needed |
| `done` | Green | Tool completed |
| `sleep` | Navy | After 5min in idle |
| `alert` | Red | Critical error/failure |

See [Features](docs/features.md) for animations, working state text, and more.

## Characters

| Character | Color | Auto-selected for |
|-----------|-------|-------------------|
| `vibemon` | Purple | Default; any bridge without its own character |
| `clawd` | Orange | Claude Code |
| `codex` | Navy | Codex CLI |
| `kiro` | White | Kiro |
| `claw` | Red | OpenClaw |
| `daangni` | Peach/teal | Manual only (Character Lock) |

> The **Color** column is each character's overall look. This is distinct from the per-character `color` in the registry, which sets the eye/accent overlay drawn on the sprite — white for VibeMon, whose face is white.

### Character Lock

Force the character to always be one of the above, regardless of what each project's status reports. Default is `auto` (each project shows its own character).

```bash
curl -X POST http://127.0.0.1:19280/character-lock \
  -H "Content-Type: application/json" \
  -d '{"character":"daangni"}'
```

Switch via system tray menu (**Character Lock** submenu) or the API above.

## HTTP API

Default port: `19280`

### POST /status

Update monitor status:

```bash
curl -X POST http://127.0.0.1:19280/status \
  -H "Content-Type: application/json" \
  -d '{"state":"working","tool":"Bash","project":"my-project"}'
```

### GET /status

Get every tracked project's status and which one the character follows:

```bash
curl http://127.0.0.1:19280/status
```

### POST /quit

Stop the application:

```bash
curl -X POST http://127.0.0.1:19280/quit
```

See [API Reference](docs/api.md) for all endpoints.

## Character Window

One persistent character + following speech bubble, tracking whichever project is active:

- A project in an active state (thinking, working, notification, ...) takes focus; otherwise the most recently updated project keeps it
- Updates from other projects are still collected in the background and shown the moment they gain focus
- Drag it anywhere; it remembers its spot across restarts

See [Features](docs/features.md) for details.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Window not appearing | Check system tray, or run `curl -X POST http://127.0.0.1:19280/show` |
| Port already in use | Check with `lsof -i :19280` |
| Hook not working | Verify Python 3: `python3 --version` |

See [Features](docs/features.md) for desktop app details.

## Related Projects

- [vibemon-esp32](https://github.com/opspresso/vibemon-esp32) - ESP32 hardware display firmware
- [vibemon-web](https://github.com/opspresso/vibemon-web) - Cloud dashboard & API ([vibemon.io](https://vibemon.io))
- [vibemon-docs](https://github.com/opspresso/vibemon-docs) - Agent hook installation & setup guide ([vibemon.io/docs](https://vibemon.io/docs))

## License

MIT

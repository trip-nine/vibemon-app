# VibeMon Local Observer for VS Code and Cursor

This companion extension records local workspace lifecycle, terminal, task, and
document-save events to `http://127.0.0.1:19280/events`. It sends no prompts,
document contents, terminal contents, environment variables, or tool output.

It works with VS Code-compatible extension hosts, including Cursor. The editor
API does not give one extension access to another AI extension's private chat,
model selection, tokens, or subagent lifecycle. Those remain marked as observed
rather than attributed unless the AI extension itself publishes an integration.

For development installation, open this directory in VS Code/Cursor and use
`Developer: Install Extension from Location...`. Packaging as a VSIX can be done
with the standard `@vscode/vsce` tool.

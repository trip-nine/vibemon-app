#!/usr/bin/env python3
"""Claude Code -> VibeMon Local hook bridge.

Reads one Claude Code hook JSON object from stdin and posts a compact,
privacy-conscious event to VibeMon's loopback-only /events endpoint.
No prompt bodies, tool output bodies, or assistant messages are persisted.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import http.client
from typing import Any

HOST = "127.0.0.1"
PORT = 19280
EVENTS_PATH = "/events"
TIMEOUT_SECONDS = 0.75
RUNTIME = os.environ.get("VIBEMON_RUNTIME") or (
    "codex" if pathlib.Path(__file__).stem.lower().startswith("codex") else (
        "antigravity" if pathlib.Path(__file__).stem.lower().startswith("antigravity") else "claude"
    )
)
FALLBACK_HOOK_EVENT = os.environ.get("VIBEMON_HOOK_EVENT")


def _text(value: Any, limit: int = 4096) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value[:limit] if value else None


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return value
    return None


def _run_git(cwd: str | None, *args: str) -> str | None:
    if not cwd:
        return None
    try:
        result = subprocess.run(
            ["git", "-C", cwd, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=0.25,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return _text(result.stdout, 2048) if result.returncode == 0 else None


def _sanitize_remote(remote: str | None) -> str | None:
    if not remote:
        return None
    # Strip HTTP basic-auth/userinfo so a credential-bearing remote is never stored.
    if remote.startswith(("http://", "https://")):
        try:
            from urllib.parse import urlsplit, urlunsplit

            parsed = urlsplit(remote)
            hostname = parsed.hostname or ""
            port = f":{parsed.port}" if parsed.port else ""
            return urlunsplit((parsed.scheme, f"{hostname}{port}", parsed.path, parsed.query, parsed.fragment))
        except (ValueError, TypeError):
            return None
    return _text(remote, 2048)


def _repo_metadata(cwd: str | None) -> dict[str, Any]:
    root = _run_git(cwd, "rev-parse", "--show-toplevel")
    branch = _run_git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
    remote = _sanitize_remote(_run_git(cwd, "config", "--get", "remote.origin.url"))
    project = pathlib.Path(root or cwd or "unknown").name
    return {
        "project": project,
        "repo": remote,
        "branch": branch,
        "cwd": cwd,
    }


def _files_from_tool(tool_name: str | None, tool_input: Any, tool_response: Any) -> list[str]:
    files: list[str] = []
    if isinstance(tool_input, dict):
        for key in ("file_path", "path", "notebook_path"):
            value = _text(tool_input.get(key), 2048)
            if value:
                files.append(value)
    if isinstance(tool_response, dict):
        for key in ("filePath", "path"):
            value = _text(tool_response.get(key), 2048)
            if value and value not in files:
                files.append(value)
    return files[:20]


def _base_event(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = _text(payload.get("session_id") or payload.get("sessionId"), 256)
    current_agent_id = _text(payload.get("agent_id") or payload.get("agentId"), 256)
    cwd = _text(payload.get("cwd") or payload.get("workspace_dir") or os.getcwd(), 2048)
    hook_name = _text(payload.get("hook_event_name") or payload.get("event_name") or FALLBACK_HOOK_EVENT, 128) or "Unknown"
    event = {
        "eventType": f"{RUNTIME}.{hook_name}",
        "runtime": RUNTIME,
        "sessionId": session_id,
        "agentId": current_agent_id or (f"session:{session_id}" if session_id else None),
        "agentType": _text(payload.get("agent_type"), 128),
        "toolUseId": _text(payload.get("tool_use_id"), 256),
        "transcriptPath": _text(payload.get("transcript_path"), 2048),
        "durationMs": _number(payload.get("duration_ms")),
        "model": _text(payload.get("model"), 256),
        "modelSource": "session-start" if payload.get("model") else None,
        **_repo_metadata(cwd),
    }
    return {key: value for key, value in event.items() if value is not None}


def _agent_tool_event(payload: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    tool_input = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
    response = payload.get("tool_response") if isinstance(payload.get("tool_response"), dict) else {}
    usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
    session_id = event.get("sessionId")
    parent = _text(payload.get("agent_id"), 256) or (f"session:{session_id}" if session_id else None)
    status = _text(response.get("status"), 64) or "completed"
    resolved_model = _text(response.get("resolvedModel"), 256)
    requested_model = _text(tool_input.get("model"), 256)

    event.update({
        "eventType": "subagent.launched" if status == "async_launched" else "subagent.completed",
        "agentId": _text(response.get("agentId"), 256) or event.get("agentId"),
        "parentAgentId": parent,
        "agentName": _text(tool_input.get("description"), 256),
        "agentType": _text(tool_input.get("subagent_type"), 128) or event.get("agentType"),
        "model": resolved_model or requested_model or event.get("model"),
        "modelSource": "resolved" if resolved_model else ("requested" if requested_model else event.get("modelSource")),
        "inputTokens": _number(usage.get("input_tokens")),
        "outputTokens": _number(usage.get("output_tokens")),
        "cacheWriteTokens": _number(usage.get("cache_creation_input_tokens")),
        "cacheReadTokens": _number(usage.get("cache_read_input_tokens")),
        "totalTokens": _number(response.get("totalTokens")),
        "durationMs": _number(response.get("totalDurationMs")) or event.get("durationMs"),
        "success": status in {"completed", "async_launched"},
        "description": _text(tool_input.get("description"), 1024),
    })
    return event


def transform(payload: dict[str, Any]) -> dict[str, Any]:
    event = _base_event(payload)
    hook_name = payload.get("hook_event_name") or payload.get("event_name") or FALLBACK_HOOK_EVENT
    tool_name = _text(payload.get("tool_name") or payload.get("toolName") or payload.get("tool"), 128)
    tool_input = payload.get("tool_input") or payload.get("tool_args")
    tool_response = payload.get("tool_response")

    if hook_name == "PostToolUse" and tool_name == "Agent":
        return {key: value for key, value in _agent_tool_event(payload, event).items() if value is not None}

    event.update({
        "tool": tool_name,
        "files": _files_from_tool(tool_name, tool_input, tool_response),
        "taskId": _text(payload.get("task_id"), 256),
        "teamId": _text(payload.get("team_name"), 256),
        "agentName": _text(payload.get("teammate_name"), 256),
        "success": False if hook_name in {"PostToolUseFailure", "StopFailure"} else None,
        "error": _text(payload.get("error") or payload.get("reason"), 2048),
    })

    if hook_name == "SubagentStart":
        event["eventType"] = "subagent.started"
        event["parentAgentId"] = f"session:{event['sessionId']}" if event.get("sessionId") else None
    elif hook_name == "SubagentStop":
        event["eventType"] = "subagent.stopped"
        event["transcriptPath"] = _text(payload.get("agent_transcript_path"), 2048) or event.get("transcriptPath")
    elif hook_name == "TaskCreated":
        event["eventType"] = "task.created"
        event["description"] = _text(payload.get("task_subject"), 1024)
    elif hook_name == "TaskCompleted":
        event["eventType"] = "task.completed"
        event["description"] = _text(payload.get("task_subject"), 1024)
    elif hook_name == "SessionStart":
        event["eventType"] = "session.started"
    elif hook_name == "SessionEnd":
        event["eventType"] = "session.ended"
    elif hook_name == "Stop":
        event["eventType"] = "turn.completed"

    return {key: value for key, value in event.items() if value is not None and value != []}


def post_event(event: dict[str, Any]) -> None:
    body = json.dumps(event, separators=(",", ":")).encode("utf-8")
    connection = http.client.HTTPConnection(HOST, PORT, timeout=TIMEOUT_SECONDS)
    try:
        # HTTPConnection does not follow redirects, preserving the loopback-only invariant.
        connection.request(
            "POST",
            EVENTS_PATH,
            body=body,
            headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
        )
        response = connection.getresponse()
        response.read(1)
    except (OSError, TimeoutError, http.client.HTTPException):
        # Hooks must never disrupt Claude Code when the desktop monitor is off.
        return
    finally:
        connection.close()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return 0
    if isinstance(payload, dict):
        post_event(transform(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

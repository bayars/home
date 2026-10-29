# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Hook: record lessons-learned signals. Fails open, never blocks.

Events handled (hook_event_name on stdin):
  PostToolUseFailure  -> tool_failure signal (silent)
  PostToolUse         -> skill_used signal when a skill is invoked or a SKILL.md is read (silent)
  UserPromptSubmit    -> user_correction signal + one-line additionalContext nudge
Set LL_DISABLE=1 to turn off.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

SECRET = re.compile(r"(?i)(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|(?:password|secret|token|api[_-]?key)\s*[=:]\s*\S+)")  # ll-allow: SC001
CORRECTION = re.compile(
    r"(?i)(^\s*(no|nope|wrong|stop)\b[,.!]?|that'?s (wrong|not (right|it|what))|not what i (asked|wanted|meant)"
    r"|\bdon'?t (do|use|add|write|run)\b|\binstead\b|\bremember (this|that)\b|\bskill (got|is|was) (it )?wrong\b"
    r"|\byou (forgot|missed|broke|ignored)\b|\bwhy did you\b|\bdo not\b)"
)
NUDGE = ("lessons-learned: the user may be correcting an approach. If a skill's instructions caused it, "
         "fix it now; at the end of the task consider the lessons-learned skill.")


def state() -> Path:
    return Path(os.environ.get("LL_HOME", Path.home() / ".claude" / "lessons-learned"))


def safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)[:80] or "unknown"


def record(session: str, sig: dict) -> None:
    d = state() / "signals"
    d.mkdir(parents=True, exist_ok=True)
    sig["ts"] = datetime.now().isoformat(timespec="seconds")
    with open(d / f"{safe(session)}.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(sig) + "\n")


def snippet(x) -> str:
    s = x if isinstance(x, str) else json.dumps(x, default=str)
    return SECRET.sub("[REDACTED]", s)[:300]


def handle(ev: dict) -> dict | None:
    name, session = ev.get("hook_event_name"), ev.get("session_id", "unknown")
    if name == "PostToolUseFailure":
        if ev.get("is_interrupt"):
            return None
        record(session, {"type": "tool_failure", "tool": ev.get("tool_name"),
                         "input": snippet(ev.get("tool_input", ""))[:160], "error": snippet(ev.get("error", ""))})
    elif name == "PostToolUse":
        tool, inp = ev.get("tool_name"), ev.get("tool_input") or {}
        if tool == "Skill" and inp.get("skill"):
            record(session, {"type": "skill_used", "skill": inp["skill"]})
        elif tool == "Read" and str(inp.get("file_path", "")).endswith("/SKILL.md"):
            record(session, {"type": "skill_used", "skill": Path(inp["file_path"]).parent.name})
    elif name == "UserPromptSubmit":
        prompt = ev.get("prompt", "")
        if prompt.lstrip().startswith("/lessons-learned") or not CORRECTION.search(prompt):
            return None
        record(session, {"type": "user_correction", "quote": snippet(prompt)})
        return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": NUDGE}}
    return None


def self_test() -> int:
    os.environ["LL_HOME"] = tempfile.mkdtemp(prefix="ll-test-")
    assert handle({"hook_event_name": "UserPromptSubmit", "session_id": "t", "prompt": "no, that's wrong"})
    assert handle({"hook_event_name": "UserPromptSubmit", "session_id": "t", "prompt": "add a button"}) is None
    handle({"hook_event_name": "PostToolUseFailure", "session_id": "t", "tool_name": "Bash", "error": "exit 1 password=hunter22"})  # ll-allow: SC001
    handle({"hook_event_name": "PostToolUse", "session_id": "t", "tool_name": "Skill", "tool_input": {"skill": "fabric-builder"}})
    lines = (state() / "signals" / "t.jsonl").read_text().splitlines()
    assert [json.loads(l)["type"] for l in lines] == ["user_correction", "tool_failure", "skill_used"], lines
    assert "hunter22" not in lines[1]
    print("signal_capture self-test ok")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if os.environ.get("LL_DISABLE"):
        return 0
    try:
        out = handle(json.load(sys.stdin))
        if out:
            print(json.dumps(out))
    except Exception:
        pass  # fail open
    return 0


if __name__ == "__main__":
    sys.exit(main())

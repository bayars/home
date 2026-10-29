# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Stop hook: ask once per session for a lessons-learned review when signals warrant it.

Triggers when the session has a user correction, or a tool failure while a skill
was in use. Never re-asks (marker file) and respects stop_hook_active.
Also prunes signal files older than 14 days. Fails open. LL_DISABLE=1 turns it off.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

PRUNE_DAYS = 14


def state() -> Path:
    return Path(os.environ.get("LL_HOME", Path.home() / ".claude" / "lessons-learned"))


def safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)[:80] or "unknown"


def prune(d: Path) -> None:
    cutoff = time.time() - PRUNE_DAYS * 86400
    for f in d.glob("*"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


def decide(ev: dict) -> dict | None:
    if ev.get("stop_hook_active"):
        return None
    d = state() / "signals"
    if not d.is_dir():
        return None
    prune(d)
    sid = safe(ev.get("session_id", "unknown"))
    sig_file, marker = d / f"{sid}.jsonl", d / f"{sid}.asked"
    if marker.exists() or not sig_file.is_file():
        return None
    sigs = [json.loads(l) for l in sig_file.read_text(encoding="utf-8").splitlines() if l.strip()]
    corrections = sum(s["type"] == "user_correction" for s in sigs)
    failures = sum(s["type"] == "tool_failure" for s in sigs)
    skills = sorted({s["skill"] for s in sigs if s["type"] == "skill_used"})
    if not (corrections or (failures and skills)):
        return None
    marker.touch()
    used = f" while using {', '.join(skills)}" if skills else ""
    return {"decision": "block", "reason": (
        f"lessons-learned: {corrections} user correction(s) and {failures} tool failure(s){used} this session "
        f"(session {ev.get('session_id')}). If a skill's instructions caused a mistake, run the lessons-learned "
        "skill review now (it proposes diffs for approval). If nothing is worth keeping, say so in one line and stop.")}


def self_test() -> int:
    os.environ["LL_HOME"] = tempfile.mkdtemp(prefix="ll-test-")
    d = state() / "signals"
    d.mkdir(parents=True)
    (d / "s.jsonl").write_text(json.dumps({"type": "tool_failure"}) + "\n")
    assert decide({"session_id": "s"}) is None, "failure without skill must not nag"
    (d / "s.jsonl").write_text(json.dumps({"type": "user_correction"}) + "\n")
    assert decide({"session_id": "s", "stop_hook_active": True}) is None
    assert decide({"session_id": "s"})["decision"] == "block"
    assert decide({"session_id": "s"}) is None, "must ask only once"
    print("stop_review self-test ok")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if os.environ.get("LL_DISABLE"):
        return 0
    try:
        out = decide(json.load(sys.stdin))
        if out:
            print(json.dumps(out))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

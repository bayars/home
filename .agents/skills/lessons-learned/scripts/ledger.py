# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Lessons-learned ledger: record, find, apply, reject and roll back lessons.

State lives in $LL_HOME (default ~/.claude/lessons-learned):
  ledger.jsonl            one JSON object per entry
  signals/<session>.jsonl hook signals
  backups/<skill>/<ts>-<ids>/  skill copy taken before each apply

Commands: add, list, find, hit, update, reject, retire, apply, rollback,
status, signals, clear-signals. Run with --help on any command.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import filecmp
import importlib.util
import json
import os
import re
import shutil
import sys
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
LL_HOME = Path(os.environ.get("LL_HOME", Path.home() / ".claude" / "lessons-learned"))
LEDGER = LL_HOME / "ledger.jsonl"
SIGNALS = LL_HOME / "signals"
BACKUPS = LL_HOME / "backups"
KINDS = ("fix", "pitfall", "lesson")
STATUSES = ("proposed", "applied", "rejected", "rejected:gate", "upstream", "retired", "rolled-back")
SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", ".git"}
MAX_EVIDENCE = 600


def _lint():
    spec = importlib.util.spec_from_file_location("lint_skill", HERE / "lint_skill.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lint_skill"] = mod
    spec.loader.exec_module(mod)
    return mod


LINT = _lint()


# ---- storage -------------------------------------------------------------
@contextlib.contextmanager
def locked():
    LL_HOME.mkdir(parents=True, exist_ok=True)
    with open(LL_HOME / ".lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        yield


def load() -> list[dict]:
    return LINT.load_ledger() if LEDGER.is_file() else []


def save(entries: list[dict]) -> None:
    tmp = LEDGER.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in entries), encoding="utf-8")
    tmp.replace(LEDGER)


def get(entries: list[dict], lid: str) -> dict:
    for e in entries:
        if e["id"] == lid:
            return e
    sys.exit(f"error: no ledger entry {lid}")


def next_id(entries: list[dict]) -> str:
    n = max((int(e["id"].split("-")[1]) for e in entries), default=0)
    return f"LL-{n + 1:04d}"


def today() -> str:
    return date.today().isoformat()


def redact(text: str) -> str:
    for rx in LINT.SECRET_PATTERNS:
        text = rx.sub("[REDACTED]", text)
    return text[:MAX_EVIDENCE]


def resolve_skill_dir(skill: str, skill_dir: str | None) -> Path | None:
    if skill_dir:
        return Path(skill_dir).expanduser().resolve()
    for root in (LINT.USER_SKILLS, Path.cwd() / ".claude" / "skills"):
        if (root / skill / "SKILL.md").is_file():
            return (root / skill).resolve()
    return None


def tree(root: Path) -> dict[str, Path]:
    out = {}
    for r, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for n in names:
            p = Path(r) / n
            out[str(p.relative_to(root))] = p
    return out


# ---- commands ------------------------------------------------------------
def cmd_add(a) -> None:
    with locked():
        entries = load()
        sdir = resolve_skill_dir(a.skill, a.skill_dir)
        status = a.status
        if sdir and LINT.is_read_only(sdir) and status == "proposed":
            status = "upstream"
        e = {
            "id": next_id(entries), "skill": a.skill, "skill_dir": str(sdir) if sdir else None,
            "kind": a.kind, "symptom": redact(a.symptom), "rule": redact(a.rule),
            "evidence": redact(a.evidence or ""), "status": status, "hits": 0,
            "session": a.session, "created": today(), "updated": today(),
        }
        entries.append(e)
        save(entries)
    print(e["id"] if not a.json else json.dumps(e))
    if status == "upstream":
        print(f"note: {a.skill} is read-only; recorded as upstream", file=sys.stderr)


def cmd_list(a) -> None:
    rows = [e for e in load() if (not a.skill or e["skill"] == a.skill) and (not a.status or e["status"] == a.status)]
    if a.json:
        print(json.dumps(rows, indent=2))
        return
    for e in rows:
        print(f"{e['id']}  {e['skill']:<22} {e['kind']:<8} {e['status']:<13} hits={e['hits']:<3} {e['updated']}  {e['rule'][:70]}")


def cmd_find(a) -> None:
    scored = []
    for e in load():
        if a.skill and e["skill"] != a.skill:
            continue
        s = max(LINT.similarity(a.text, e["symptom"]), LINT.similarity(a.text, e["rule"]),
                LINT.similarity(a.text, e["symptom"] + " " + e["rule"]))
        if s >= a.threshold:
            scored.append((s, e))
    for s, e in sorted(scored, key=lambda x: -x[0]):
        print(f"{s:.2f}  {e['id']}  {e['skill']}  {e['kind']}  {e['status']}  {e['rule'][:80]}")
    if not scored:
        print("no similar entries")


def _mutate(lid: str, **fields) -> dict:
    with locked():
        entries = load()
        e = get(entries, lid)
        e.update({k: v for k, v in fields.items() if v is not None}, updated=today())
        save(entries)
    return e


def cmd_hit(a) -> None:
    with locked():
        entries = load()
        e = get(entries, a.id)
        e["hits"] += 1
        e["updated"] = today()
        save(entries)
    print(f"{a.id} hits={e['hits']}")


def cmd_update(a) -> None:
    e = _mutate(a.id, rule=a.rule and redact(a.rule), symptom=a.symptom and redact(a.symptom),
                kind=a.kind, status=a.status)
    print(json.dumps(e))


def cmd_reject(a) -> None:
    _mutate(a.id, status="rejected", reject_reason=redact(a.reason))
    add_signal(a.session or "manual", {"type": "proposal_rejected", "skill": "lessons-learned", "id": a.id, "reason": redact(a.reason)})
    print(f"{a.id} rejected; reason recorded as a signal against lessons-learned")


def cmd_retire(a) -> None:
    _mutate(a.id, status="retired", note=a.note)
    print(f"{a.id} retired")


def cmd_apply(a) -> None:
    src = Path(a.from_dir).expanduser().resolve()
    with locked():
        entries = load()
        targets = [get(entries, i) for i in a.ids]
        sdir = Path(a.skill_dir).expanduser().resolve() if a.skill_dir else resolve_skill_dir(targets[0]["skill"], targets[0].get("skill_dir"))
        if not sdir or not (sdir / "SKILL.md").is_file():
            sys.exit("error: target skill directory not found (pass --skill-dir)")
        if LINT.is_read_only(sdir):
            sys.exit(f"error: {sdir} is read-only (plugin/synced/marketplace); record as upstream instead")
        if not (src / "SKILL.md").is_file():
            sys.exit(f"error: {src} has no SKILL.md")
        # Lint the patched copy as if it lived at the target (name must match the dir name).
        findings = LINT.Linter(src).run()
        errors = [f for f in findings if f.level == "E" and f.code != "FM002"]
        if errors:
            for f in errors:
                print(f"  E {f.code} {f.file}:{f.line} {f.message}", file=sys.stderr)
            sys.exit("error: patched copy fails lint; consolidate before applying")

        old, new = tree(sdir), tree(src)
        changed = [r for r in new if r not in old or not filecmp.cmp(old[r], new[r], shallow=False)]
        removed = [r for r in old if r not in new]
        if not changed and not removed:
            sys.exit("error: no changes between copy and target")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = BACKUPS / sdir.name / f"{stamp}-{'_'.join(a.ids)}"
        shutil.copytree(sdir, backup, ignore=shutil.ignore_patterns(*SKIP_DIRS))
        for r in changed:
            dest = sdir / r
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(new[r], dest)
        for r in removed:
            (sdir / r).unlink()
        for e in targets:
            e.update(status="applied", updated=today(), backup=str(backup), skill_dir=str(sdir),
                     changed=changed, removed=removed, added=[r for r in changed if r not in old])
        save(entries)
    print(f"applied {', '.join(a.ids)} to {sdir}")
    for r in changed:
        print(f"  M {r}" if r in old else f"  A {r}")
    for r in removed:
        print(f"  D {r}")
    print(f"backup: {backup}")


def cmd_rollback(a) -> None:
    with locked():
        entries = load()
        e = get(entries, a.id)
        if e["status"] != "applied" or not e.get("backup"):
            sys.exit(f"error: {a.id} is '{e['status']}', nothing to roll back")
        backup, sdir = Path(e["backup"]), Path(e["skill_dir"])
        for r in e.get("changed", []) + e.get("removed", []):
            if r in e.get("added", []):
                (sdir / r).unlink(missing_ok=True)
            elif (backup / r).is_file():
                (sdir / r).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup / r, sdir / r)
        for other in entries:
            if other.get("backup") == e["backup"]:
                other.update(status="rolled-back", updated=today())
        save(entries)
    add_signal(a.session or "manual", {"type": "rollback", "skill": "lessons-learned", "id": a.id, "target": e["skill"]})
    print(f"rolled back {a.id} in {sdir} (from {backup}); logged as a signal against lessons-learned")


def cmd_status(a) -> None:
    entries = load()
    by_skill: dict[str, dict[str, int]] = {}
    for e in entries:
        by_skill.setdefault(e["skill"], {}).setdefault(e["status"], 0)
        by_skill[e["skill"]][e["status"]] += 1
    print("Ledger:")
    for s, counts in sorted(by_skill.items()):
        print(f"  {s:<24} " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    if not by_skill:
        print("  (empty)")
    print("\nBudgets (SKILL.md):")
    for d in LINT.discover():
        lines = (d / "SKILL.md").read_text(encoding="utf-8", errors="replace").splitlines()
        p = len(LINT.section_bullets(lines, "Pitfalls"))
        l = len(LINT.section_bullets(lines, "Lessons"))
        flag = "  ← near cap" if max(p, l) >= 8 or len(lines) > LINT.MAX_LINES_WARN else ""
        ro = " (read-only)" if LINT.is_read_only(d) else ""
        print(f"  {d.name:<24} lines={len(lines):<4} pitfalls={p}/10  lessons={l}/10{ro}{flag}")
    stale = [e for e in entries if e["status"] == "applied" and e["hits"] == 0
             and (date.today() - date.fromisoformat(e["updated"])).days > LINT.STALE_DAYS]
    if stale:
        print("\nStale (retire candidates): " + ", ".join(e["id"] for e in stale))
    pending = sorted(SIGNALS.glob("*.jsonl")) if SIGNALS.is_dir() else []
    if pending:
        print("\nPending signals:")
        for f in pending:
            print(f"  {f.stem}: {sum(1 for _ in f.open())}")


def add_signal(session: str, sig: dict) -> None:
    SIGNALS.mkdir(parents=True, exist_ok=True)
    sig.setdefault("ts", datetime.now().isoformat(timespec="seconds"))
    with open(SIGNALS / f"{safe(session)}.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(sig) + "\n")


def safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)[:80] or "unknown"


def cmd_signals(a) -> None:
    files = sorted(SIGNALS.glob("*.jsonl"), key=lambda p: p.stat().st_mtime) if SIGNALS.is_dir() else []
    if a.session:
        files = [f for f in files if f.stem == safe(a.session)]
    elif a.latest:
        files = files[-1:]
    for f in files:
        print(f"# session {f.stem}")
        for line in f.read_text(encoding="utf-8").splitlines():
            print(line)
    if not files:
        print("no pending signals")


def cmd_clear_signals(a) -> None:
    for suffix in (".jsonl", ".asked"):
        (SIGNALS / f"{safe(a.session)}{suffix}").unlink(missing_ok=True)
    print(f"cleared signals for {a.session}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add", help="record a new entry; prints its LL-id")
    p.add_argument("--skill", required=True)
    p.add_argument("--kind", choices=KINDS, required=True)
    p.add_argument("--symptom", required=True)
    p.add_argument("--rule", required=True)
    p.add_argument("--evidence", default="")
    p.add_argument("--skill-dir")
    p.add_argument("--session")
    p.add_argument("--status", choices=STATUSES, default="proposed")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("list")
    p.add_argument("--skill")
    p.add_argument("--status", choices=STATUSES)
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("find", help="find similar entries before adding (dedupe)")
    p.add_argument("--text", required=True)
    p.add_argument("--skill")
    p.add_argument("--threshold", type=float, default=0.35)
    p.set_defaults(fn=cmd_find)

    p = sub.add_parser("hit", help="the entry prevented or matched a mistake again")
    p.add_argument("id")
    p.set_defaults(fn=cmd_hit)

    p = sub.add_parser("update")
    p.add_argument("id")
    p.add_argument("--rule")
    p.add_argument("--symptom")
    p.add_argument("--kind", choices=KINDS)
    p.add_argument("--status", choices=STATUSES)
    p.set_defaults(fn=cmd_update)

    p = sub.add_parser("reject")
    p.add_argument("id")
    p.add_argument("--reason", required=True)
    p.add_argument("--session")
    p.set_defaults(fn=cmd_reject)

    p = sub.add_parser("retire")
    p.add_argument("id")
    p.add_argument("--note", default="")
    p.set_defaults(fn=cmd_retire)

    p = sub.add_parser("apply", help="lint the patched copy, back up the skill, copy changes in")
    p.add_argument("ids", nargs="+")
    p.add_argument("--from", dest="from_dir", required=True, help="patched copy of the skill dir")
    p.add_argument("--skill-dir")
    p.set_defaults(fn=cmd_apply)

    p = sub.add_parser("rollback")
    p.add_argument("id")
    p.add_argument("--session")
    p.set_defaults(fn=cmd_rollback)

    sub.add_parser("status").set_defaults(fn=cmd_status)

    p = sub.add_parser("signals")
    p.add_argument("--session")
    p.add_argument("--latest", action="store_true")
    p.set_defaults(fn=cmd_signals)

    p = sub.add_parser("clear-signals")
    p.add_argument("--session", required=True)
    p.set_defaults(fn=cmd_clear_signals)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Lint Claude Code skills against references/skill-rules.md.

Usage:
  uv run --script lint_skill.py <skill-dir> [<skill-dir> ...] [--exec] [--json]
  uv run --script lint_skill.py --all [--exec] [--json]

Exit code 1 if any error (E) finding, else 0. A line containing
`ll-allow: <CODE>` suppresses that code for that line.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tomllib
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path

HOME = Path.home()
LL_HOME = Path(os.environ.get("LL_HOME", HOME / ".claude" / "lessons-learned"))
USER_SKILLS = HOME / ".claude" / "skills"
CLAUDE_MD = HOME / ".claude" / "CLAUDE.md"

MAX_LINES_WARN, MAX_LINES_ERR, MAX_TOKENS_WARN = 300, 500, 5000
MAX_BULLETS, MAX_LESSON_CHARS, MAX_PITFALL_CHARS = 10, 200, 250
SIMILARITY = 0.8
STALE_DAYS = 90

SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", ".git", ".pytest_cache"}
CODE_EXT = {".py", ".js", ".mjs", ".cjs", ".ts", ".sh", ".bash", ".rb", ".go", ".rs", ".pl", ".ps1"}
TEXT_EXT = CODE_EXT | {".md", ".toml", ".json", ".yaml", ".yml", ".txt", ".cfg", ".ini", ""}
RUNTIMES = {"none", "uv", "docker"}
LL_TAG = re.compile(r"\[LL-\d{4,}\]")

SECRET_PATTERNS = [
    re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile("-----BEGIN " + r"(?:[A-Z]+ )?PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*['\"]?(?![<${])[^\s'\"`<>]{6,}"),
    re.compile(r"(?i)\btoken\s*=\s*['\"]?[A-Za-z0-9_\-]{10,}|\btoken\s*:\s*['\"][A-Za-z0-9_\-]{10,}"),
    re.compile(r"\b[\w.+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]{2,}\b"),
]
EMAIL_ALLOW = re.compile(r"noreply@|no-reply@|@anthropic\.com\b|git@")

HOST_INSTALL = [
    (re.compile(r"\bpip3? install\b"), "pip install"),  # ll-allow: EV005
    (re.compile(r"\bpython3? -m pip install\b"), "python -m pip install"),  # ll-allow: EV005
    (re.compile(r"\bnpm (?:install|i|add) (?:.* )?(?:-g|--global)\b"), "npm install -g"),  # ll-allow: EV005
    (re.compile(r"\byarn global add\b"), "yarn global add"),  # ll-allow: EV005
    (re.compile(r"(?:^|[\s;&|(`])sudo\s"), "sudo"),  # ll-allow: EV005
    (re.compile(r"\bapt(?:-get)? install\b"), "apt install"),  # ll-allow: EV005
    (re.compile(r"\bbrew install\b"), "brew install"),  # ll-allow: EV005
    (re.compile(r"\bcurl\b[^\n|]*\|\s*(?:ba|z)?sh\b"), "curl | sh"),  # ll-allow: EV005
    (re.compile(r"\bwget\b[^\n|]*\|\s*(?:ba|z)?sh\b"), "wget | sh"),  # ll-allow: EV005
]
BARE_RUN = re.compile(r"(?<![\w/.-])(python3?|node|npx|bun|deno|ts-node)\s+(?:-\S+\s+)*[^\s`|;]*\.(?:py|m?js|cjs|ts)\b")
PEP723 = re.compile(r"(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\s(?P<content>(^#(| .*)$\s)+)^# ///$")
GENERIC_PATH = re.compile(r"(?<![\w.`])(?:~|/(?:root|home|Users|tmp|var|etc|opt))/[\w./-]+")
GENERIC_DATE = re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")
GENERIC_TICKET = re.compile(r"\b(?!(?:LL|UTF|SHA|ISO|RFC|PEP|CVE|TLS|HTTP|IPV|MD)-)[A-Z][A-Z0-9]{1,9}-\d{2,6}\b")


@dataclass
class Finding:
    level: str  # E | W | I
    code: str
    file: str
    line: int
    message: str


class Linter:
    def __init__(self, skill_dir: Path, run_exec: bool = False, claude_md: Path | None = CLAUDE_MD):
        self.dir = skill_dir.resolve()
        self.run_exec = run_exec
        self.claude_md = claude_md
        self.findings: list[Finding] = []

    # ---- helpers -------------------------------------------------------
    def add(self, level: str, code: str, file: Path | str, line: int, msg: str, text: str = "") -> None:
        if text and f"ll-allow: {code}" in text:
            return
        rel = str(Path(file).relative_to(self.dir)) if Path(file).is_absolute() else str(file)
        self.findings.append(Finding(level, code, rel, line, msg))

    def files(self):
        for root, dirs, names in os.walk(self.dir):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for n in names:
                yield Path(root) / n

    def text_files(self):
        for p in self.files():
            if p.suffix in TEXT_EXT and not p.name.endswith(".lock") and p.name not in {"package-lock.json"}:
                try:
                    if p.stat().st_size <= 1_000_000:
                        yield p, p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue

    # ---- run -----------------------------------------------------------
    def run(self) -> list[Finding]:
        skill_md = self.dir / "SKILL.md"
        if not skill_md.is_file():
            self.add("E", "FM001", "SKILL.md", 0, "SKILL.md not found")
            return self.findings
        if is_read_only(self.dir):
            self.add("I", "RO001", "SKILL.md", 0, "read-only skill (plugin/synced/marketplace): lessons are logged as 'upstream', never applied")
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        fm, body_start = parse_frontmatter(lines)
        self.check_frontmatter(fm)
        self.check_size(text, lines)
        self.check_links(text, lines)
        lessons = section_bullets(lines, "Lessons")
        pitfalls = section_bullets(lines, "Pitfalls")
        self.check_lessons(lessons)
        self.check_pitfalls(pitfalls, lessons)
        self.check_duplicates(lessons + pitfalls)
        self.check_secrets()
        self.check_staleness(fm.get("name", self.dir.name))
        self.check_environment(lines)
        return self.findings

    def check_frontmatter(self, fm: dict) -> None:
        if not fm:
            self.add("E", "FM001", "SKILL.md", 1, "missing YAML frontmatter with name/description")
            return
        name, desc = fm.get("name", ""), fm.get("description", "")
        if not name or not desc:
            self.add("E", "FM001", "SKILL.md", 1, "frontmatter needs both 'name' and 'description'")
        if name and (not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or name != self.dir.name):
            self.add("E", "FM002", "SKILL.md", 1, f"name '{name}' must be kebab-case and equal the directory name '{self.dir.name}'")
        if len(desc) > 1024:
            self.add("E", "FM003", "SKILL.md", 1, f"description is {len(desc)} chars (max 1024)")
        if desc and not re.search(r"(?i)\b(use (it )?(when|whenever|after|before|for|to|if)|trigger|invoke when)\b", desc):
            self.add("W", "FM004", "SKILL.md", 1, "description should say when to use the skill ('Use when …')")

    def check_size(self, text: str, lines: list[str]) -> None:
        n = len(lines)
        if n > MAX_LINES_ERR:
            self.add("E", "SZ002", "SKILL.md", n, f"{n} lines (max {MAX_LINES_ERR}); move detail to references/")
        elif n > MAX_LINES_WARN:
            self.add("W", "SZ001", "SKILL.md", n, f"{n} lines (budget {MAX_LINES_WARN}); move detail to references/")
        tokens = len(text) // 4
        if tokens > MAX_TOKENS_WARN:
            self.add("W", "SZ003", "SKILL.md", 1, f"~{tokens} tokens (budget {MAX_TOKENS_WARN})")

    def check_links(self, text: str, lines: list[str]) -> None:
        for i, line in enumerate(lines, 1):
            targets = re.findall(r"\]\(([^)\s#]+)(?:#[^)]*)?\)", line)
            targets += re.findall(r"`((?:references|scripts|assets|examples|env)/[^`\s]*)`", line)
            for t in targets:
                if re.match(r"[a-z]+://|mailto:", t) or t.startswith(("/", "~", "$")):
                    continue
                t = t.rstrip(".,:;")
                if any(ch in t for ch in "*<>{}"):
                    continue
                if not (self.dir / t).exists():
                    self.add("E", "PD001", "SKILL.md", i, f"link to missing file '{t}'", line)
        refs = self.dir / "references"
        if refs.is_dir():
            for p in sorted(refs.rglob("*")):
                if p.is_file() and p.name not in text and str(p.relative_to(self.dir)) not in text:
                    if p.name in {"pitfalls.md", "lessons.md"}:
                        continue
                    self.add("W", "PD002", p, 0, "reference file is not mentioned in SKILL.md")

    def check_lessons(self, lessons: list[tuple[int, str]]) -> None:
        if len(lessons) > MAX_BULLETS:
            self.add("E", "LS001", "SKILL.md", lessons[MAX_BULLETS][0], f"{len(lessons)} lessons (max {MAX_BULLETS}); consolidate")
        for ln, b in lessons:
            if len(b) > MAX_LESSON_CHARS:
                self.add("E", "LS002", "SKILL.md", ln, f"lesson is {len(b)} chars (max {MAX_LESSON_CHARS})", b)
            if not LL_TAG.search(b):
                self.add("E", "LS003", "SKILL.md", ln, "lesson lacks a ledger tag [LL-xxxx]", b)
            self.check_generic(ln, b)

    def check_pitfalls(self, pitfalls: list[tuple[int, str]], lessons: list[tuple[int, str]]) -> None:
        if len(pitfalls) > MAX_BULLETS:
            self.add("E", "PF001", "SKILL.md", pitfalls[MAX_BULLETS][0], f"{len(pitfalls)} pitfalls (max {MAX_BULLETS}); consolidate")
        for ln, b in pitfalls:
            if len(b) > MAX_PITFALL_CHARS:
                self.add("E", "PF002", "SKILL.md", ln, f"pitfall is {len(b)} chars (max {MAX_PITFALL_CHARS})", b)
            if b.count("→") < 2 or not LL_TAG.search(b):
                self.add("E", "PF003", "SKILL.md", ln, "pitfall must be '**trigger** → why → instead [LL-xxxx]'", b)
            for _, lb in lessons:
                if similarity(b, lb) >= SIMILARITY:
                    self.add("W", "PF005", "SKILL.md", ln, "pitfall duplicates a lesson; keep one", b)
            self.check_generic(ln, b)
        extra = self.dir / "references" / "pitfalls.md"
        if extra.is_file():
            more = [b for b in extra.read_text(encoding="utf-8").splitlines() if re.match(r"^[-*] ", b)]
            if len(more) > MAX_BULLETS:
                self.add("E", "PF004", extra, 0, f"{len(more)} pitfalls in references/pitfalls.md (max {MAX_BULLETS}; 20 per skill total)")

    def check_generic(self, ln: int, b: str) -> None:
        for rx, what in ((GENERIC_PATH, "an absolute path"), (GENERIC_DATE, "a date"), (GENERIC_TICKET, "a ticket/incident id")):
            if rx.search(LL_TAG.sub("", b)):
                self.add("W", "GN001", "SKILL.md", ln, f"bullet names {what}; keep specifics in ledger evidence", b)
                return

    def check_duplicates(self, bullets: list[tuple[int, str]]) -> None:
        for i, (ln, a) in enumerate(bullets):
            for ln2, b in bullets[i + 1:]:
                if similarity(a, b) >= SIMILARITY:
                    self.add("W", "DU001", "SKILL.md", ln2, f"near-duplicate of line {ln}", b)
        if self.claude_md and self.claude_md.is_file():
            cm = [l for l in self.claude_md.read_text(encoding="utf-8", errors="replace").splitlines() if len(l.split()) >= 4]
            for ln, b in bullets:
                if any(similarity(b, c) >= SIMILARITY for c in cm):
                    self.add("W", "DU002", "SKILL.md", ln, "restates a line of ~/.claude/CLAUDE.md", b)

    def check_secrets(self) -> None:
        for p, text in self.text_files():
            for i, line in enumerate(text.splitlines(), 1):
                for rx in SECRET_PATTERNS:
                    m = rx.search(line)
                    if m and not EMAIL_ALLOW.search(m.group(0)):
                        self.add("E", "SC001", p, i, f"possible secret or personal data: '{m.group(0)[:12]}…'", line)
                        break

    def check_staleness(self, name: str) -> None:
        today = date.today()
        for e in load_ledger():
            if e.get("skill") != name or e.get("status") != "applied" or e.get("hits", 0):
                continue
            try:
                age = (today - datetime.strptime(e.get("updated") or e["created"], "%Y-%m-%d").date()).days
            except (KeyError, ValueError):
                continue
            if age > STALE_DAYS:
                self.add("W", "ST001", "SKILL.md", 0, f"{e['id']} applied {age} days ago with 0 hits; candidate to retire")

    # ---- environment ---------------------------------------------------
    def check_environment(self, skill_lines: list[str]) -> None:
        code = [p for p in self.files() if p.suffix in CODE_EXT and "env" not in p.relative_to(self.dir).parts[:1]]
        has_scripts = (self.dir / "scripts").is_dir()
        manifest_path = self.dir / "skill-env.toml"
        manifest: dict = {}
        if manifest_path.is_file():
            try:
                manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
            except tomllib.TOMLDecodeError as e:
                self.add("E", "EV002", manifest_path, 0, f"invalid TOML: {e}")
                return
        elif code or has_scripts:
            self.add("E", "EV001", "skill-env.toml", 0, "skill ships code but declares no environment (add skill-env.toml: runtime = uv|docker)")
        runtime = manifest.get("runtime", "none" if not (code or has_scripts) else None)

        if manifest:
            if runtime not in RUNTIMES:
                self.add("E", "EV002", manifest_path, 0, f"runtime must be one of {sorted(RUNTIMES)}")
            elif runtime == "none" and (code or has_scripts):
                self.add("E", "EV002", manifest_path, 0, "runtime = 'none' but the skill ships code")
            for name, rel in (manifest.get("entrypoints") or {}).items():
                if not (self.dir / rel).is_file():
                    self.add("E", "EV009", manifest_path, 0, f"entrypoint '{name}' → '{rel}' does not exist")

        if runtime == "uv":
            for p in code:
                if p.suffix != ".py":
                    if p.suffix not in {".sh", ".bash"}:
                        self.add("E", "EV002", p, 0, f"runtime 'uv' only covers Python; '{p.suffix}' code needs runtime 'docker'")
                    continue
                src = p.read_text(encoding="utf-8", errors="replace")
                meta = pep723(src)
                if meta is None:
                    self.add("E", "EV003", p, 1, "missing PEP 723 '# /// script' block (requires-python, dependencies)")
                elif meta.get("dependencies") and not Path(str(p) + ".lock").is_file():
                    self.add("W", "EV007", p, 1, "has dependencies but no lock; run `uv lock --script`")

        if runtime == "docker":
            df = self.dir / "env" / "Dockerfile"
            if not df.is_file():
                self.add("E", "EV006", "env/Dockerfile", 0, "runtime 'docker' requires env/Dockerfile")
            else:
                stages: set[str] = set()
                for i, line in enumerate(df.read_text(encoding="utf-8").splitlines(), 1):
                    m = re.match(r"(?i)^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?", line)
                    if not m:
                        continue
                    image, stage = m.group(1), m.group(2)
                    if stage:
                        stages.add(stage.lower())
                    if image == "scratch" or image.lower() in stages or "@sha256:" in image:
                        continue
                    tag = image.rsplit("/", 1)[-1].partition(":")[2]
                    if not tag or tag == "latest":
                        self.add("E", "EV006", df, i, f"unpinned base image '{image}' (use an explicit tag or digest)", line)
            if manifest.get("network", "none") != "none" and not manifest.get("network_reason"):
                self.add("W", "EV008", manifest_path, 0, "network enabled without network_reason")

        for i, line in enumerate(skill_lines, 1):
            m = BARE_RUN.search(line)
            if m and (code or has_scripts):
                self.add("E", "EV004", "SKILL.md", i, f"runs code with bare '{m.group(1)}'; use the declared runner (uv run --script / scripts/run.sh)", line)

        for p, text in self.text_files():
            rel = p.relative_to(self.dir)
            if rel.parts[0] == "env":
                continue  # installs inside the container image are fine
            chunks = fenced_blocks(text) if p.suffix == ".md" and p.name != "SKILL.md" else enumerate(text.splitlines(), 1)
            for i, line in chunks:
                for rx, what in HOST_INSTALL:
                    if rx.search(line):
                        self.add("E", "EV005", p, i, f"host/global install '{what}' — dependencies belong in PEP 723 headers or env/Dockerfile", line)
                        break

        if self.run_exec and runtime in {"uv", "docker"}:
            self.exec_smoke(runtime, manifest)

    def exec_smoke(self, runtime: str, manifest: dict) -> None:
        if not shutil.which(runtime):
            self.add("E", "EV010", "skill-env.toml", 0, f"runner '{runtime}' is not installed; skills never fall back to the host")
            return
        smoke = manifest.get("smoke") or {}
        for name, rel in (manifest.get("entrypoints") or {}).items():
            path = self.dir / rel
            if not path.is_file():
                continue
            args = shlex.split(smoke.get(name, "--help"))
            if runtime == "uv" and path.suffix == ".py":
                cmd = ["uv", "run", "--quiet", "--script", str(path), *args]
            else:
                cmd = ["bash", str(path), *args]
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=600, stdin=subprocess.DEVNULL)
            except subprocess.TimeoutExpired:
                self.add("E", "EV010", path, 0, f"smoke test '{name}' timed out")
                continue
            if r.returncode != 0:
                tail = (r.stderr or r.stdout).strip().splitlines()[-1:] or [""]
                self.add("E", "EV010", path, 0, f"smoke test '{name}' exited {r.returncode}: {tail[0][:160]}")


# ---- module helpers ----------------------------------------------------
def parse_frontmatter(lines: list[str]) -> tuple[dict, int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    fm: dict[str, str] = {}
    key, buf, folded = None, [], False
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            if key:
                fm[key] = " ".join(buf).strip() if folded else "\n".join(buf).strip()
            return fm, i + 1
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m and not line.startswith((" ", "\t")):
            if key:
                fm[key] = " ".join(buf).strip() if folded else "\n".join(buf).strip()
            key, val = m.group(1), m.group(2).strip()
            folded = val in {">", ">-", "|", "|-", ">+", "|+"}
            buf = [] if folded else [val.strip("'\"")]
        elif key:
            buf.append(line.strip())
    return {}, 0


def section_bullets(lines: list[str], title: str) -> list[tuple[int, str]]:
    out, inside, fence = [], False, False
    for i, line in enumerate(lines, 1):
        if line.startswith("```"):
            fence = not fence
        if fence:
            continue
        if re.match(r"^#{1,2} ", line):
            inside = re.match(rf"^##\s+{title}\s*$", line, re.I) is not None
            continue
        if inside and re.match(r"^[-*] ", line):
            out.append((i, line[2:].strip()))
        elif inside and out and line.startswith("  ") and line.strip():
            n, prev = out[-1]
            out[-1] = (n, prev + " " + line.strip())
    return out


def fenced_blocks(text: str):
    fence = False
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if fence:
            yield i, line


def pep723(src: str) -> dict | None:
    for m in PEP723.finditer(src):
        if m.group("type") == "script":
            content = "".join(l[2:] if l.startswith("# ") else l[1:] for l in m.group("content").splitlines(keepends=True))
            try:
                return tomllib.loads(content)
            except tomllib.TOMLDecodeError:
                return {}
    return None


def tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", LL_TAG.sub("", s).lower()) if len(w) > 2}


def similarity(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def is_read_only(path: Path) -> bool:
    parts = path.resolve().parts
    return "synced" in parts or "plugins" in parts or "marketplaces" in parts


def load_ledger() -> list[dict]:
    f = LL_HOME / "ledger.jsonl"
    if not f.is_file():
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def discover() -> list[Path]:
    roots = [USER_SKILLS, Path.cwd() / ".claude" / "skills"]
    seen, out = set(), []
    for root in roots:
        if not root.is_dir():
            continue
        for d in sorted(root.iterdir()):
            if d.is_dir() and (d / "SKILL.md").is_file() and d.name != "synced" and d.resolve() not in seen:
                seen.add(d.resolve())
                out.append(d)
    return out


def lint(skill_dir: Path, run_exec: bool = False) -> list[Finding]:
    return Linter(skill_dir, run_exec).run()


def main() -> int:
    ap = argparse.ArgumentParser(description="Lint skills against the lessons-learned skill rules.")
    ap.add_argument("dirs", nargs="*", type=Path, help="skill directories")
    ap.add_argument("--all", action="store_true", help="lint every managed user and project skill")
    ap.add_argument("--exec", action="store_true", help="also smoke-test entrypoints in their declared environment")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()
    dirs = discover() if args.all else args.dirs
    if not dirs:
        ap.error("give skill directories or --all")
    report, errors = {}, 0
    for d in dirs:
        fs = lint(d, args.exec)
        report[str(d)] = [asdict(f) for f in fs]
        errors += sum(f.level == "E" for f in fs)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for d, fs in report.items():
            e = sum(f["level"] == "E" for f in fs)
            w = sum(f["level"] == "W" for f in fs)
            print(f"{'FAIL' if e else 'OK  '} {d}  ({e} errors, {w} warnings)")
            for f in fs:
                loc = f"{f['file']}:{f['line']}" if f["line"] else f["file"]
                print(f"  {f['level']} {f['code']} {loc}  {f['message']}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

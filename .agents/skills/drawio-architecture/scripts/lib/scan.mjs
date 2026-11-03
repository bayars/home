// Finds the draw.io files that already exist under a folder and says, for each page, what it
// shows: its description if it has one, otherwise what can be read from its labels. This is
// the first step of any request, so that an existing diagram is updated instead of a second
// one being drawn beside it. Read-only: nothing is opened except the diagram files themselves.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { lintText, plainLabel } from "./lint.mjs";
import { styleMap } from "./xml.mjs";
import { sourceLine } from "./meta.mjs";

// Folders that hold dependencies, build output or tool state. A diagram found there is a copy.
const SKIP_DIRS = new Set(["node_modules", "bower_components", "vendor", "dist", "build", "out", "target", "coverage", "venv", "__pycache__"]);
const READABLE = /\.(drawio|dio)$|\.drawio\.xml$/i;
const EMBEDDED = /\.drawio\.(svg|png)$/i;                     // a picture with the diagram inside it; not read here
const MAX_FILES = 200, MAX_DEPTH = 8, MAX_BYTES = 30 * 1024 * 1024, MAX_ENTRIES = 20000;
const ICON_SETS = [[/mxgraph\.aws\d?\./, "AWS"], [/img\/lib\/azure|mxgraph\.azure/, "Azure"], [/mxgraph\.gcp\d?\./, "Google Cloud"], [/mxgraph\.kubernetes/, "Kubernetes"], [/mxgraph\.cisco/, "Cisco"], [/shape=mxgraph\.c4|c4Name/, "C4"]];

// Text from a file of unknown origin is printed on one line, without control characters, and cut to length,
// so it cannot pass itself off as part of this tool's own output.
const short = (s, n) => { const t = String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** What one page contains, from the parsed file alone (no rendering). */
export function summarisePage(page) {
  const cells = page.cells, locked = new Set(page.layers.filter(l => l.locked).map(l => l.id));
  const verts = cells.filter(c => c.vertex && !locked.has(c.parent)), edges = cells.filter(c => c.edge);
  const parents = new Set(verts.map(c => c.parent));
  const labels = c => plainLabel(c.value);
  const uniq = list => [...new Set(list.map(labels).filter(Boolean))];
  const styles = verts.map(c => c.style).join(";");
  return {
    index: page.index + 1, name: page.name, description: page.meta.description, built: page.meta.built, edited: page.meta.edited, hasSpec: !!page.meta.spec,
    source: sourceLine(page.meta), shapes: verts.length, edges: edges.length,
    boundaries: uniq(verts.filter(c => parents.has(c.id))),
    components: uniq(verts.filter(c => !parents.has(c.id) && !styleMap(c.style).text && c.id !== "diagram_title")),
    icons: ICON_SETS.filter(([re]) => re.test(styles)).map(([, name]) => name),
  };
}

/**
 * paths: folders or files. Returns { files: [{ path, modified, pages | error }], embedded: [paths], truncated, searched }.
 * Hidden folders, dependency and build folders, and symbolic links are not entered.
 */
export function scan(paths, { depth = MAX_DEPTH, cwd = process.cwd() } = {}) {
  const found = [], embedded = [];
  let entries = 0, truncated = false;
  const rel = p => relative(cwd, p) || ".";
  const take = (file, st) => {
    if (EMBEDDED.test(file)) { embedded.push(rel(file)); return; }
    if (!READABLE.test(file)) return;
    if (found.length >= MAX_FILES) { truncated = true; return; }
    found.push({ abs: file, path: rel(file), modified: st.mtime.toISOString().slice(0, 10), size: st.size });
  };
  const walk = (dir, level) => {
    let names;
    try { names = readdirSync(dir).sort(); } catch { return; }                 // unreadable folder: skipped
    for (const name of names) {
      if (++entries > MAX_ENTRIES) { truncated = true; return; }
      const full = join(dir, name);
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (level < depth && !name.startsWith(".") && !SKIP_DIRS.has(name)) walk(full, level + 1); }
      else if (st.isFile()) take(full, st);
    }
  };
  for (const p of paths) {
    const abs = resolve(cwd, p);
    const st = lstatSync(abs);                                                   // a path that does not exist is the caller's error
    if (st.isDirectory()) walk(abs, 1);
    else if (st.isFile()) { if (READABLE.test(abs) || EMBEDDED.test(abs)) take(abs, st); else found.push({ abs, path: rel(abs), modified: st.mtime.toISOString().slice(0, 10), size: st.size }); }
  }
  const files = found.map(f => {
    const out = { path: f.path, modified: f.modified };
    if (f.size > MAX_BYTES) return { ...out, error: `not read: ${(f.size / 1048576).toFixed(0)} MB is over the ${MAX_BYTES / 1048576} MB limit` };
    try { out.pages = lintText(readFileSync(f.abs, "utf8")).pages.map(summarisePage); }
    catch (e) { if (e.code !== "XML") throw e; out.error = "not a readable draw.io file: " + e.message; }
    return out;
  });
  return { files, embedded, truncated, searched: paths.map(p => rel(resolve(cwd, p))) };
}

/** The scan as text, short enough to read in one go. Text taken from the files is quoted and cut to length. */
export function formatScan(result) {
  const lines = [];
  const pages = result.files.flatMap(f => f.pages ?? []);
  const described = pages.filter(p => p.description).length;
  if (!result.files.length) lines.push(`No draw.io files under ${result.searched.join(", ")}.`);
  else lines.push(`${result.files.length} draw.io file${result.files.length === 1 ? "" : "s"} under ${result.searched.join(", ")}: ${pages.length} page${pages.length === 1 ? "" : "s"}, ${described} with a description.`);
  for (const f of result.files) {
    lines.push("", `${f.path}   (modified ${f.modified})`);
    if (f.error) { lines.push("  " + f.error); continue; }
    for (const p of f.pages) {
      lines.push(`  page ${p.index} "${short(p.name, 60)}": ${p.shapes} shapes, ${p.edges} edges` + (p.icons.length ? `, ${p.icons.join(" + ")} icons` : ""));
      if (p.description) lines.push("    description: " + short(p.description, 800));
      else {
        const b = p.boundaries.slice(0, 6).map(s => short(s, 28)), c = p.components.slice(0, 12).map(s => short(s, 28));
        lines.push("    no description." + (b.length ? " Boundaries: " + b.join(", ") + (p.boundaries.length > b.length ? ` (+${p.boundaries.length - b.length})` : "") + "." : "") +
          (c.length ? " Contains: " + c.join(", ") + (p.components.length > c.length ? ` (+${p.components.length - c.length})` : "") + "." : p.shapes ? "" : " The page is empty."));
      }
      lines.push("    " + p.source);
    }
  }
  if (result.embedded.length) lines.push("", `Not read (diagrams saved inside a picture; open them in draw.io): ${result.embedded.slice(0, 8).join(", ")}` + (result.embedded.length > 8 ? ` and ${result.embedded.length - 8} more` : ""));
  if (result.truncated) lines.push("", `The search stopped early (limit: ${MAX_FILES} files). Scan a narrower folder to see the rest.`);
  return lines.join("\n");
}

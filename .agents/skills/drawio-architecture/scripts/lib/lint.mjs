// Structural checks that need no browser, plus a compact text outline of a file.
import { listCells, readDrawio, styleMap } from "./xml.mjs";
import { readMeta, sourceLine } from "./meta.mjs";

const stripTags = s => String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
export const plainLabel = stripTags;

/** Returns { pages, findings }. Throws only when the file is not readable XML at all. */
export function lintText(text) {
  const { pages } = readDrawio(text);
  const findings = [];
  const add = (page, severity, kind, ids, message) => findings.push({ page: page.index + 1, severity, kind, ids, message });
  for (const page of pages) {
    if (page.compressed) add(page, "info", "compressed", [], "this page is stored compressed; run the decompress command before editing its XML by hand");
    const cells = listCells(page.model);
    page.cells = cells ?? [];
    page.layers = [];
    page.meta = page.model ? readMeta(page.model) : { description: null, built: false, spec: null, edited: null };
    if (!cells) { add(page, "error", "no-root", [], "the page has no <root> element"); continue; }
    const byId = new Map();
    for (const c of cells) {
      if (c.id == null || c.id === "") { add(page, "error", "missing-id", [], "a cell has no id"); continue; }
      if (byId.has(c.id)) add(page, "error", "duplicate-id", [c.id], `id "${c.id}" is used by more than one cell`);
      else byId.set(c.id, c);
    }
    const root0 = cells.find(c => c.parent == null && !c.vertex && !c.edge);
    // Layers are the plain cells directly under the root cell, back to front. New shapes belong in the
    // first one that is not locked (a locked layer holds the background box).
    const layers = root0 ? cells.filter(c => c.parent === root0.id && !c.vertex && !c.edge) : [];
    const layer = layers.find(c => styleMap(c.style).locked !== "1") ?? layers[0];
    page.layers = layers.map(c => ({ id: c.id, name: c.value, locked: styleMap(c.style).locked === "1" }));
    if (!root0 || !layer) add(page, "error", "no-root-cells", [], 'the two base cells are missing: <mxCell id="0"/> and <mxCell id="1" parent="0"/>');
    const drawn = cells.filter(c => c.vertex || c.edge);
    if (!drawn.length) add(page, "warning", "empty-page", [], "the page has no shapes or edges");
    else if (!page.meta.description) add(page, "info", "no-description", [], "the page does not say what it shows. Add a description with the describe command, so the diagram can be found and understood when it next needs changing");
    const chain = id => { const out = []; const seen = new Set(); for (let p = byId.get(id)?.parent; p != null && byId.has(p) && !seen.has(p); p = byId.get(p).parent) { out.push(p); seen.add(p); } return out; };
    for (const c of drawn) {
      const id = c.id ?? "?";
      if (c.parent == null) add(page, "error", "missing-parent", [id], `"${id}" has no parent attribute (use parent="1" for the top level)`);
      else if (!byId.has(c.parent)) add(page, "error", "missing-parent", [id], `"${id}" has parent "${c.parent}", which does not exist`);
      else { const seen = new Set([id]); for (let p = c.parent; p != null && byId.has(p); p = byId.get(p).parent) { if (seen.has(p)) { add(page, "error", "parent-cycle", [id], `"${id}" is inside itself through its parent chain`); break; } seen.add(p); } }
      if (!c.geometry) add(page, "error", c.edge ? "edge-no-geometry" : "vertex-no-geometry", [id], c.edge
        ? `edge "${id}" has no <mxGeometry relative="1" as="geometry"/> child, so draw.io will not draw it`
        : `shape "${id}" has no <mxGeometry> child`);
      if (c.vertex && c.geometry && !c.geometry.relative && (c.geometry.width <= 0 || c.geometry.height <= 0)) add(page, "warning", "zero-size", [id], `shape "${id}" has no width or height`);
      const st = styleMap(c.style);
      if (/<\/?(b|i|u|br|font|span|div|p|sup|sub|hr|table)\b[^>]*>/i.test(c.value) && st.html !== "1") add(page, "warning", "html-not-enabled", [id], `"${id}" has HTML tags in its label but its style lacks html=1, so the tags will show as text`);
      if (c.value.includes("\\n")) add(page, "warning", "literal-newline", [id], `"${id}" has a literal \\n in its label; use &#xa; or <br> for a line break`);
      if (/[\n\r]/.test(c.style) || /(^|;)\s*[\w-]+\s*:\s*[^;=]+(;|$)/.test(c.style)) add(page, "warning", "style-syntax", [id], `"${id}" has a malformed style (styles are key=value pairs separated by semicolons)`);
      if (c.edge) {
        for (const end of ["source", "target"]) {
          if (c[end] != null && !byId.has(c[end])) add(page, "error", "dangling-edge", [id], `edge "${id}" has ${end} "${c[end]}", which does not exist`);
          else if (c[end] == null && !(c.geometry && c.geometry[end + "Point"])) add(page, "error", "dangling-edge", [id], `edge "${id}" has no ${end}`);
          else if (c[end] != null && byId.get(c[end]).edge) add(page, "warning", "edge-to-edge", [id], `edge "${id}" is attached to another edge ("${c[end]}")`);
        }
        if (c.source != null && c.target != null && byId.has(c.source) && byId.has(c.target) && c.parent != null && byId.has(c.parent)) {
          // draw.io keeps an edge in the innermost cell that holds both ends (an end that is a container counts as holding itself).
          const up = id => [id, ...chain(id)];
          const inTarget = new Set(up(c.target));
          const nca = up(c.source).find(p => inTarget.has(p));
          const ncaCell = nca != null ? byId.get(nca) : null;
          if (ncaCell && ncaCell.vertex && c.parent !== nca)
            add(page, "warning", "edge-parent", [id], `edge "${id}" has parent "${c.parent}" but both of its ends are inside "${nca}"; set parent="${nca}" so layout and routing treat it correctly`);
          else if (ncaCell && !ncaCell.vertex && !ncaCell.edge && byId.get(c.parent).vertex) {
            const want = ncaCell.parent == null ? (layer ? layer.id : "1") : nca;
            add(page, "warning", "edge-parent", [id], `edge "${id}" sits inside container "${c.parent}" but its ends are not both inside it; set parent="${want}" or the edge can be clipped`);
          }
        }
      }
    }
  }
  return { pages, findings };
}

const shapeOf = style => {
  const st = styleMap(style);
  const inner = st.resIcon || st.grIcon || st.prIcon;
  if (inner) return String(inner).replace(/^mxgraph\./, "");
  if (st.image) return "image:" + String(st.image).split("/").pop().slice(0, 40).replace(/^data:.*/, "(embedded)");
  if (st.shape) return String(st.shape).replace(/^mxgraph\./, "");
  for (const k of ["swimlane", "ellipse", "rhombus", "text", "group", "triangle", "hexagon", "image", "label"]) if (st[k] === true) return k;
  return st.rounded === "1" ? "rounded box" : "box";
};

/** A short, indented description of every page: what a model needs to edit a file without reading its raw XML. */
export function outline(text, { maxLabel = 48 } = {}) {
  const { pages } = lintText(text);
  const out = [];
  for (const page of pages) {
    const cells = page.cells;
    const verts = cells.filter(c => c.vertex), edges = cells.filter(c => c.edge);
    const locked = new Set(page.layers.filter(l => l.locked).map(l => l.id));
    const scenery = verts.filter(c => locked.has(c.parent)).length;      // the background box is not one of the diagram's shapes
    out.push(`Page ${page.index + 1} "${page.name}"${page.compressed ? " (compressed)" : ""}: ${verts.length - scenery} shapes, ${edges.length} edges` + (scenery ? ", on a locked background" : ""));
    out.push("  description: " + (page.meta.description ? page.meta.description.replace(/\s*\n\s*/g, " ") : "(none)"));
    out.push("  source: " + sourceLine(page.meta));
    if (page.layers.length > 1) out.push("  layers, back to front: " + page.layers.map(l => `${l.id}${l.name ? ` "${stripTags(l.name)}"` : ""}${l.locked ? " (locked)" : ""}`).join(", ") +
      `. New shapes go in "${(page.layers.find(l => !l.locked) ?? page.layers[0]).id}".`);
    const byParent = new Map();
    for (const c of verts) { if (!byParent.has(c.parent)) byParent.set(c.parent, []); byParent.get(c.parent).push(c); }
    const ids = new Set(cells.map(c => c.id));
    const label = c => { const l = stripTags(c.value); return l ? ` "${l.length > maxLabel ? l.slice(0, maxLabel - 1) + "…" : l}"` : ""; };
    const print = (c, depth) => {
      const g = c.geometry;
      out.push(`${"  ".repeat(depth + 1)}${c.id}${label(c)}  [${shapeOf(c.style)}]` + (g ? `  x=${g.x} y=${g.y} ${g.width}x${g.height}` : "") + (locked.has(c.parent) ? "  (background, in a locked layer: leave it alone)" : ""));
      for (const k of byParent.get(c.id) ?? []) print(k, depth + 1);
    };
    for (const c of verts.filter(c => !verts.some(v => v.id === c.parent))) print(c, 0);
    if (edges.length) out.push("  edges:");
    for (const e of edges) out.push(`    ${e.id}: ${e.source ?? "(none)"} -> ${e.target ?? "(none)"}${label(e)}` + (e.parent && ids.has(e.parent) && verts.some(v => v.id === e.parent) ? `  (in ${e.parent})` : "") + (e.geometry && e.geometry.points.length ? `  ${e.geometry.points.length} waypoints` : ""));
  }
  return out.join("\n");
}

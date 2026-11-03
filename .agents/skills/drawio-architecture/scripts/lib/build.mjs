// spec (JSON) -> automatic layout (ELK) -> draw.io XML.
//
// The spec says what exists and how it is nested and connected. This module
// decides every size and coordinate, so nothing in a spec is a position.
import { createRequire } from "node:module";
import { join } from "node:path";
import { catalog, kinds, resolveIcon, suggestIcons } from "./catalog.mjs";
import { blockSize, escapeHtml, escapeXml, lineWidth, wrap } from "./text.mjs";
import { nodeCacheDir, SCRIPTS_DIR } from "./paths.mjs";
import { placeLabel, routeLoose } from "./route.mjs";
import { readDrawio } from "./xml.mjs";
import { descriptionProblems, fingerprint, GENERATOR } from "./meta.mjs";

export class SpecError extends Error {
  constructor(problems) { super("the spec has " + problems.length + " problem" + (problems.length === 1 ? "" : "s")); this.problems = problems; }
}

const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const TOP_KEYS = ["title", "description", "direction", "spacing", "iconSize", "background", "nodes", "groups", "edges"];
const MIN_DESCRIPTION = 20;
// The white background: a box in a locked layer behind everything (see references/xml-editing.md).
export const BACKDROP_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=none;";
export const BACKDROP_MARGIN = 20;
export const LAYER_ID = "background_layer", BOX_ID = "backdrop";
const RESERVED_IDS = ["diagram_title", BOX_ID, LAYER_ID];
const NODE_KEYS = ["id", "label", "icon", "kind", "parent", "tech", "desc", "color", "size"];
const GROUP_KEYS = ["id", "label", "kind", "parent", "color", "parallel"];
const EDGE_KEYS = ["id", "from", "to", "label", "dashed", "both", "arrow", "color", "layout"];
const DIRECTIONS = { right: "RIGHT", down: "DOWN", left: "LEFT", up: "UP" };
const SPACING = { compact: 0.75, normal: 1, roomy: 1.35 };
const ICON_LABEL_WRAP = 140;
const EDGE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=1;curved=0;html=1;endArrow=block;endFill=1;strokeColor=#4D4D4D;fontSize=11;fontColor=#333333;";
// The white backdrop sits in its own locked layer under the diagram, so it cannot be selected or dragged by
// accident. Every colour in the file is explicit and colour adaptation is off, so the diagram looks the same
// in a light and a dark editor, and exports on white.

/** Loads the ELK layout engine from the cache folder (installed by `setup`), the skill folder, or the global path. */
export function loadElk() {
  const tried = [];
  for (const base of [join(nodeCacheDir(), "package.json"), join(SCRIPTS_DIR, "package.json"), join(process.cwd(), "package.json")]) {
    try { return createRequire(base)("elkjs/lib/elk.bundled.js"); } catch (e) { tried.push(base); }
  }
  throw Object.assign(new Error("the layout library (elkjs) is not installed. Run: node " + join(SCRIPTS_DIR, "drawio-arch.mjs") + " setup"), { code: "NO_ELK", tried });
}

const styleGet = (style, key) => (new RegExp("(?:^|;)" + key + "=([^;]*)").exec(style) || [])[1];
const styleSet = (style, key, value) => {
  const re = new RegExp("(^|;)" + key + "=[^;]*");
  return re.test(style) ? style.replace(re, "$1" + key + "=" + value) : style + key + "=" + value + ";";
};

// ---- validation -------------------------------------------------------------------
function validate(spec) {
  const problems = [];
  const bad = m => problems.push(m);
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new SpecError(["the spec must be a JSON object with nodes, groups and edges"]);
  for (const k of Object.keys(spec)) if (!TOP_KEYS.includes(k)) bad(`unknown top-level field "${k}" (allowed: ${TOP_KEYS.join(", ")})`);
  const nodes = spec.nodes ?? [], groups = spec.groups ?? [], edges = spec.edges ?? [];
  const before = problems.length;
  if (!Array.isArray(nodes) || !nodes.length) bad('"nodes" must be a non-empty array');
  if (!Array.isArray(groups)) bad('"groups" must be an array');
  if (!Array.isArray(edges)) bad('"edges" must be an array');
  if (problems.length > before) throw new SpecError(problems);     // nothing else can be checked without these
  if (spec.direction != null && !DIRECTIONS[spec.direction]) bad(`direction must be one of ${Object.keys(DIRECTIONS).join(", ")}`);
  if (spec.spacing != null && !SPACING[spec.spacing]) bad(`spacing must be one of ${Object.keys(SPACING).join(", ")}`);
  if (spec.iconSize != null && !(spec.iconSize >= 24 && spec.iconSize <= 128)) bad("iconSize must be a number from 24 to 128");
  if (spec.background != null && !["white", "none"].includes(spec.background)) bad('background must be "white" or "none"');
  if (spec.title != null && typeof spec.title !== "string") bad("title must be text");
  // The description is stored in the file (not drawn), so that the diagram can be found and understood later.
  if (spec.description == null) bad('"description" is missing: say in a few sentences what this diagram shows and how the system works. It is stored in the file, not drawn, and is how the diagram is found when it needs updating');
  else if (typeof spec.description === "string" && spec.description.trim().length < MIN_DESCRIPTION) bad(`description is too short to be useful (under ${MIN_DESCRIPTION} characters): say what the diagram shows and how the system works`);
  else for (const m of descriptionProblems(spec.description)) bad(m);

  const K = kinds();
  const all = new Map();
  const claim = (o, what, i, allowed) => {
    const where = `${what}[${i}]` + (o && typeof o.id === "string" ? ` "${o.id}"` : "");
    if (!o || typeof o !== "object" || Array.isArray(o)) { bad(`${where} must be an object`); return null; }
    for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${where}: unknown field "${k}" (allowed: ${allowed.join(", ")})`);
    if (typeof o.id !== "string" || !ID.test(o.id)) { bad(`${where}: id must start with a letter and use only letters, digits, _ . - (max 64)`); return null; }
    if (all.has(o.id)) { bad(`${where}: id "${o.id}" is used more than once`); return null; }
    if (RESERVED_IDS.includes(o.id)) { bad(`${where}: id "${o.id}" is reserved for the diagram itself; pick another`); return null; }
    for (const k of ["label", "tech", "desc", "parent", "kind", "icon", "color"]) if (o[k] != null && typeof o[k] !== "string") bad(`${where}: ${k} must be text`);
    if (o.color != null && !K.palette[o.color]) bad(`${where}: color must be one of ${Object.keys(K.palette).join(", ")}`);
    return where;
  };
  groups.forEach((g, i) => {
    const where = claim(g, "groups", i, GROUP_KEYS); if (!where) return;
    all.set(g.id, { ...g, isGroup: true });
    const kind = g.kind ?? "group";
    if (!K.groups[kind]) bad(`${where}: unknown group kind "${kind}". Known kinds: ${Object.keys(K.groups).join(", ")}`);
    if (g.parallel != null && typeof g.parallel !== "boolean") bad(`${where}: parallel must be true or false`);
  });
  nodes.forEach((n, i) => {
    const where = claim(n, "nodes", i, NODE_KEYS); if (!where) return;
    all.set(n.id, { ...n, isGroup: false });
    if (n.icon != null && n.kind != null) bad(`${where}: give either icon or kind, not both`);
    if (n.icon != null && !resolveIcon(n.icon)) {
      const s = suggestIcons(n.icon);
      bad(`${where}: unknown icon "${n.icon}".` + (s.length ? ` Did you mean: ${s.join(", ")}?` : "") + ` Search with: drawio-arch.mjs icons <words>`);
    }
    if (n.icon == null && !K.nodes[n.kind ?? "service"]) bad(`${where}: unknown kind "${n.kind}". Known kinds: ${Object.keys(K.nodes).join(", ")}`);
    if (n.icon != null && (n.tech != null || n.desc != null)) bad(`${where}: tech and desc only apply to box kinds, not to icons (put the detail in the label)`);
    if (n.size != null && !(n.size >= 16 && n.size <= 200)) bad(`${where}: size must be a number from 16 to 200`);
  });
  for (const o of all.values()) {
    if (o.parent == null) continue;
    const p = all.get(o.parent);
    if (!p) bad(`"${o.id}": parent "${o.parent}" does not exist`);
    else if (!p.isGroup) bad(`"${o.id}": parent "${o.parent}" is a node; only groups can contain things`);
  }
  for (const g of all.values()) {                       // a group cannot be inside itself
    const seen = new Set([g.id]);
    for (let p = g.parent; p != null && all.get(p); p = all.get(p).parent) {
      if (seen.has(p)) { bad(`"${g.id}": parent chain loops back on itself`); break; }
      seen.add(p);
    }
  }
  const edgeIds = new Set();
  edges.forEach((e, i) => {
    const where = `edges[${i}]`;
    if (!e || typeof e !== "object" || Array.isArray(e)) { bad(`${where} must be an object`); return; }
    for (const k of Object.keys(e)) if (!EDGE_KEYS.includes(k)) bad(`${where}: unknown field "${k}" (allowed: ${EDGE_KEYS.join(", ")})`);
    for (const end of ["from", "to"]) if (typeof e[end] !== "string" || !all.has(e[end])) bad(`${where}: ${end} "${e[end]}" is not the id of a node or group`);
    if (e.from === e.to && all.has(e.from)) bad(`${where}: from and to are the same ("${e.from}")`);
    if (e.id != null) { if (typeof e.id !== "string" || !ID.test(e.id) || all.has(e.id) || edgeIds.has(e.id) || RESERVED_IDS.includes(e.id)) bad(`${where}: id must be a unique identifier`); else edgeIds.add(e.id); }
    if (e.label != null && typeof e.label !== "string") bad(`${where}: label must be text`);
    if (e.arrow != null && !["end", "none"].includes(e.arrow)) bad(`${where}: arrow must be "end" or "none"`);
    for (const k of ["dashed", "both", "layout"]) if (e[k] != null && typeof e[k] !== "boolean") bad(`${where}: ${k} must be true or false`);
    if (e.color != null && !K.palette[e.color]) bad(`${where}: color must be one of ${Object.keys(K.palette).join(", ")}`);
  });
  if (problems.length) throw new SpecError(problems);
  return { all, nodes, groups, edges };
}

// ---- sizing ------------------------------------------------------------------------
// Labels that sit outside a shape go below it when the diagram flows sideways and beside it when the
// diagram flows up or down, so that edges (which attach on the flow axis) never run through the label.
function outsideLabel(style, lines, fs, bold, vertical) {
  const text = blockSize(lines, fs, bold);
  if (!vertical) return { style, side: "below", width: text.width + 4, height: text.height + 4 };
  for (const [k, v] of [["labelPosition", "right"], ["verticalLabelPosition", "middle"], ["align", "left"], ["verticalAlign", "middle"], ["spacingLeft", "4"], ["spacingTop", "0"]]) style = styleSet(style, k, v);
  return { style, side: "right", width: text.width + 10, height: text.height + 4 };
}

function describeNode(n, spec) {
  const K = kinds();
  const label = n.label ?? n.id;
  const vertical = spec.direction === "down" || spec.direction === "up";
  if (n.icon != null) {
    const ic = resolveIcon(n.icon);
    const target = n.size ?? spec.iconSize ?? 48;
    const scale = target / Math.max(ic.w, ic.h);
    let style = ic.style;
    if (styleGet(style, "html") !== "1") style = styleSet(style, "html", "1");
    if (styleGet(style, "fontColor") == null) style = styleSet(style, "fontColor", "#1a1a1a");      // never leave text to the editor's theme
    const fs = Number(styleGet(style, "fontSize") || 12), bold = (Number(styleGet(style, "fontStyle") || 0) & 1) === 1;
    const lines = wrap(label, ICON_LABEL_WRAP, fs, bold);
    const out = outsideLabel(style, lines, fs, bold, vertical);
    return { width: Math.max(8, Math.round(ic.w * scale)), height: Math.max(8, Math.round(ic.h * scale)), style: out.style, value: lines.map(escapeHtml).join("<br>"), below: out };
  }
  const def = K.nodes[n.kind ?? "service"];
  let style = def.s;
  if (n.color) { const c = K.palette[n.color]; style = styleSet(styleSet(style, "fillColor", c.fill), "strokeColor", c.stroke); }
  if (styleGet(style, "fontColor") == null) style = styleSet(style, "fontColor", "#1a1a1a");
  if (def.label === "below") {
    const lines = wrap(label, ICON_LABEL_WRAP, 12);
    const out = outsideLabel(style, lines, 12, false, vertical);
    return { width: def.w, height: def.h, style: out.style, value: lines.map(escapeHtml).join("<br>"), below: out };
  }
  // Box with the label inside: title, optional [technology] line, optional description.
  const padX = def.padX ?? 24, padY = def.padY ?? 20, maxW = def.maxW ?? 220, fs = Number(styleGet(style, "fontSize") || 12);
  const tech = def.c4 ? `[${def.c4}${n.tech ? ": " + n.tech : ""}]` : (n.tech ? `[${n.tech}]` : null);
  const rich = tech != null || n.desc != null;
  const inner = maxW - padX;
  const titleLines = wrap(label, inner, fs, rich);
  const techLines = tech ? wrap(tech, inner, fs - 2) : [];
  const descLines = n.desc ? wrap(n.desc, inner, fs - 1) : [];
  const widest = Math.max(blockSize(titleLines, fs, rich).width, blockSize(techLines, fs - 2).width, blockSize(descLines, fs - 1).width);
  const textH = blockSize(titleLines, fs, rich).height + blockSize(techLines, fs - 2).height + (descLines.length ? blockSize(descLines, fs - 1).height + 6 : 0);
  let html = titleLines.map(escapeHtml).join("<br>");
  if (rich) html = "<b>" + html + "</b>";
  if (tech) html += `<br><font style="font-size:${fs - 2}px">${escapeHtml(tech)}</font>`;
  if (n.desc) html += `<br><font style="font-size:${fs - 1}px"><br>${n.desc.split("\n").map(escapeHtml).join("<br>")}</font>`;
  if (def.valign === "bottom") style = styleSet(styleSet(style, "verticalAlign", "bottom"), "spacingBottom", "8");
  return { width: Math.min(maxW, Math.max(def.minW, widest + padX)), height: Math.max(def.minH, textH + padY + (n.desc ? fs : 0)), style, value: html, below: null };
}

function describeGroup(g) {
  const K = kinds();
  const def = K.groups[g.kind ?? "group"];
  let style = def.s;
  if (g.color) { const c = K.palette[g.color]; style = styleSet(styleSet(style, "fillColor", c.fill), "strokeColor", c.stroke); }
  for (const [k, v] of [["container", "1"], ["collapsible", "0"], ["recursiveResize", "0"], ["pointerEvents", "0"]]) if (styleGet(style, k) == null) style += `${k}=${v};`;
  const fs = Number(styleGet(style, "fontSize") || 12), bold = (Number(styleGet(style, "fontStyle") || 0) & 1) === 1;
  const label = g.label ?? g.id;
  const titleW = lineWidth(label.replace(/\n/g, " "), fs, bold);
  const minWidth = def.align === "center" ? titleW + 2 * def.inset + 8 : def.inset + titleW + 16;
  return { def, style, value: escapeHtml(label.replace(/\n/g, " ")), minWidth: Math.ceil(minWidth), top: def.top };
}

// ---- layout --------------------------------------------------------------------------
export async function buildDiagram(spec, { ELK } = {}) {
  const { all, nodes, groups, edges } = validate(spec);
  const k = SPACING[spec.spacing ?? "normal"];
  const info = new Map();
  const kids = new Map();
  for (const o of all.values()) {
    info.set(o.id, o.isGroup ? describeGroup(o) : describeNode(o, spec));
    const p = o.parent ?? "";
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(o);
  }
  const warnings = [];
  for (const g of groups) if (!kids.has(g.id)) warnings.push(`group "${g.id}" has nothing inside it`);

  const spacingOptions = {
    "elk.spacing.nodeNode": String(Math.round(32 * k)),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(Math.round(56 * k)),
    "elk.spacing.edgeNode": String(Math.round(18 * k)),
    "elk.layered.spacing.edgeNodeBetweenLayers": String(Math.round(18 * k)),
    "elk.spacing.edgeEdge": "12",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
    "elk.spacing.edgeLabel": "4",
    "elk.spacing.labelNode": "2",
    "elk.spacing.componentComponent": String(Math.round(40 * k)),
  };
  const pad = Math.round(18 * k);
  const toElk = o => {
    const d = info.get(o.id);
    if (o.isGroup) return {
      id: o.id,
      layoutOptions: { ...spacingOptions, "elk.padding": `[top=${d.top + Math.round(8 * k)},left=${pad},bottom=${pad},right=${pad}]`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE", "elk.nodeSize.minimum": `(${d.minWidth},${d.top + 34})` },
      children: (kids.get(o.id) ?? []).map(toElk),
    };
    const node = { id: o.id, width: d.width, height: d.height };
    if (d.below) { node.labels = [{ text: "x", width: d.below.width, height: d.below.height }]; node.layoutOptions = { "elk.nodeLabels.placement": d.below.side === "right" ? "OUTSIDE V_CENTER H_RIGHT" : "OUTSIDE V_BOTTOM H_CENTER" }; }
    return node;
  };
  // Ancestors of an id, nearest first.
  const up = id => { const c = []; for (let p = all.get(id).parent; p != null; p = all.get(p).parent) c.push(p); return c; };
  const isParallel = id => { const g = all.get(id); return g.isGroup && (g.parallel ?? kinds().groups[g.kind ?? "group"].parallel === true); };
  // An edge between two "parallel" sibling groups (availability zones, regions) would force one group after
  // the other. Such edges are left out of the layout and routed afterwards, so the groups sit side by side.
  const looseByDefault = (a, b) => {
    const ca = [a, ...up(a)], cb = [b, ...up(b)];
    const inB = new Set(cb);
    const k = ca.findIndex(p => inB.has(p));
    const childA = k < 0 ? ca[ca.length - 1] : ca[k - 1];
    const childB = k < 0 ? cb[cb.length - 1] : cb[cb.indexOf(ca[k]) - 1];
    return childA != null && childB != null && childA !== childB && isParallel(childA) && isParallel(childB);
  };
  const edgeDefs = edges.map((e, i) => {
    const id = e.id ?? "e" + (i + 1);
    const lines = e.label ? e.label.split("\n") : [];
    const t = blockSize(lines, 11);
    const label = lines.length ? { w: t.width + 8, h: t.height + 4 } : null;
    return { spec: e, id, lines, label, loose: e.layout === false || (e.layout !== true && looseByDefault(e.from, e.to)),
      elk: { id, sources: [e.from], targets: [e.to], labels: label ? [{ text: "x", width: label.w, height: label.h }] : [] } };
  });
  const taken = new Set(all.keys());
  for (const d of edgeDefs) { if (taken.has(d.id) && !d.spec.id) { let n = 1; while (taken.has("edge" + n)) n++; d.id = d.elk.id = "edge" + n; } taken.add(d.id); }

  const graph = {
    id: "__root__",
    layoutOptions: { ...spacingOptions, "elk.algorithm": "layered", "elk.direction": DIRECTIONS[spec.direction ?? "right"],
      // One layout pass over the whole nesting. Without groups, leave it off so that unconnected parts are packed into a block.
      ...(groups.length ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : { "elk.aspectRatio": "1.6" }),
      "elk.edgeRouting": "ORTHOGONAL", "elk.edgeLabels.inline": "true", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.thoroughness": "20", "elk.json.edgeCoords": "ROOT", "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      ...JSON.parse(process.env.DRAWIO_ARCH_ELK_OPTIONS || "{}") },        // for experiments by maintainers; see docs/MAINTENANCE.md
    children: (kids.get("") ?? []).map(toElk),
    edges: edgeDefs.filter(d => !d.loose).map(d => d.elk),
  };
  const Elk = ELK ?? loadElk();
  const laid = await new Elk().layout(graph);

  // ---- snap to whole pixels, consistently for nodes and edges ---------------------------
  const MARGIN = 20;
  const titleLines = spec.title ? wrap(spec.title, Math.max(300, laid.width), 18, true) : [];
  const titleH = titleLines.length ? blockSize(titleLines, 18, true).height + 18 : 0;
  const ox = MARGIN, oy = MARGIN + titleH;
  const abs = new Map();                                   // id -> {x,y,w,h} absolute, integers
  const walk = (n, tx, ty) => {
    for (const c of n.children ?? []) {
      const ax = tx + c.x, ay = ty + c.y;
      const x = Math.round(ax), y = Math.round(ay);
      abs.set(c.id, { x, y, w: Math.max(1, Math.round(ax + c.width) - x), h: Math.max(1, Math.round(ay + c.height) - y) });
      walk(c, ax, ay);
    }
  };
  walk(laid, ox, oy);
  const collect = (n, acc) => { for (const e of n.edges ?? []) acc.push(e); for (const c of n.children ?? []) collect(c, acc); return acc; };
  const laidEdges = new Map(collect(laid, []).map(e => [e.id, e]));

  // ---- edge routes: from the layout, then the loose ones threaded through what is left ----
  const P = p => ({ x: Math.round(p.x + ox), y: Math.round(p.y + oy) });
  const routes = new Map(), segments = [], usedPorts = [], labelRects = [];
  const keepRoute = (d, pts, center) => {
    routes.set(d.id, { pts, center });
    for (let i = 0; i + 1 < pts.length; i++) segments.push([pts[i], pts[i + 1]]);
    usedPorts.push(pts[0], pts[pts.length - 1]);
    if (center && d.label) labelRects.push({ x: center.x - d.label.w / 2, y: center.y - d.label.h / 2, w: d.label.w, h: d.label.h });
  };
  for (const d of edgeDefs.filter(d => !d.loose)) {
    const le = laidEdges.get(d.id);
    let secs = (le && le.sections) || [];
    if (secs.length > 1) {                                  // a route split into chained sections: put them in order
      const byId = new Map(secs.map(s => [s.id, s]));
      const ordered = []; let cur = secs.find(s => !(s.incomingSections && s.incomingSections.length)) ?? secs[0];
      while (cur && !ordered.includes(cur)) { ordered.push(cur); cur = byId.get((cur.outgoingSections ?? [])[0]); }
      secs = ordered;
    }
    if (!secs.length) continue;
    const pts = [];
    for (const s of secs) for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) { const q = P(p); const n = pts.length; if (!n || pts[n - 1].x !== q.x || pts[n - 1].y !== q.y) pts.push(q); }
    const lab = le.labels && le.labels[0];
    keepRoute(d, pts, lab && d.label ? { x: lab.x + ox + lab.width / 2, y: lab.y + oy + lab.height / 2 } : null);
  }
  const leafRects = [], leafLabels = [];
  for (const o of all.values()) {
    if (o.isGroup) continue;
    const a = abs.get(o.id), d = info.get(o.id);
    leafRects.push({ rect: a });
    if (d.below) leafLabels.push({ pad: 4, rect: d.below.side === "right"
      ? { x: a.x + a.w + 1, y: a.y + a.h / 2 - d.below.height / 2, w: d.below.width, h: d.below.height }
      : { x: a.x + a.w / 2 - d.below.width / 2, y: a.y + a.h + 1, w: d.below.width, h: d.below.height } });
  }
  const groupStrips = [];
  for (const g of groups) {
    const a = abs.get(g.id), d = info.get(g.id);
    groupStrips.push({ x: a.x - 3, y: a.y - 3, w: a.w + 6, h: 6 }, { x: a.x - 3, y: a.y + a.h - 3, w: a.w + 6, h: 6 }, { x: a.x - 3, y: a.y, w: 6, h: a.h }, { x: a.x + a.w - 3, y: a.y, w: 6, h: a.h },
      d.def.align === "center" ? { x: a.x + a.w / 2 - d.minWidth / 2, y: a.y, w: d.minWidth, h: d.top } : { x: a.x, y: a.y, w: d.minWidth, h: d.top });
  }
  const bounds = { x: ox, y: oy, w: laid.width, h: laid.height };
  for (const d of edgeDefs.filter(d => d.loose)) {
    const e = d.spec;
    const end = id => ({ rect: abs.get(id), labelSide: all.get(id).isGroup || !info.get(id).below ? null : info.get(id).below.side });
    const pts = routeLoose({ source: end(e.from), target: end(e.to), obstacles: [...leafRects, ...leafLabels, ...labelRects.map(r => ({ rect: r, pad: 3 }))], segments, usedPorts, bounds });
    if (!pts) { warnings.push(`edge ${e.from} -> ${e.to} could not be routed around the other shapes; draw.io will draw it as a simple connector`); continue; }
    // Keep the label clear of shapes, other labels, lines already drawn, and the borders and titles of boundaries.
    const center = d.label ? placeLabel(pts, d.label, [...leafRects.map(o => o.rect), ...leafLabels.map(o => o.rect), ...labelRects, ...groupStrips,
      ...segments.map(([p, q]) => ({ x: Math.min(p.x, q.x) - 3, y: Math.min(p.y, q.y) - 3, w: Math.abs(p.x - q.x) + 6, h: Math.abs(p.y - q.y) + 6 }))]) : null;
    keepRoute(d, pts, center);
  }

  // ---- XML ---------------------------------------------------------------------------------
  const white = (spec.background ?? "white") === "white";
  const cells = [];
  const emitVertex = (o) => {
    const d = info.get(o.id), a = abs.get(o.id), p = o.parent ? abs.get(o.parent) : { x: 0, y: 0 };
    cells.push(`<mxCell id="${escapeXml(o.id)}" value="${escapeXml(d.value)}" style="${escapeXml(d.style)}" vertex="1" parent="${escapeXml(o.parent ?? "1")}">` +
      `<mxGeometry x="${a.x - p.x}" y="${a.y - p.y}" width="${a.w}" height="${a.h}" as="geometry"/></mxCell>`);
    for (const c of kids.get(o.id) ?? []) emitVertex(c);
  };
  if (titleLines.length) {
    const w = Math.max(blockSize(titleLines, 18, true).width + 16, 200);
    cells.push(`<mxCell id="diagram_title" value="${escapeXml(titleLines.map(escapeHtml).join("<br>"))}" style="text;html=1;align=left;verticalAlign=top;strokeColor=none;fillColor=none;fontSize=18;fontStyle=1;fontColor=#1a1a1a;" vertex="1" parent="1">` +
      `<mxGeometry x="${MARGIN}" y="${MARGIN}" width="${w}" height="${titleH - 10}" as="geometry"/></mxCell>`);
  }
  for (const o of kids.get("") ?? []) emitVertex(o);

  const commonParent = (a, b) => {
    // The innermost group that holds both ends. A group that is itself an endpoint counts as holding its own contents.
    const ca = [...(all.get(a).isGroup ? [a] : []), ...up(a)], cb = new Set([...(all.get(b).isGroup ? [b] : []), ...up(b)]);
    return ca.find(p => cb.has(p)) ?? null;
  };
  const frac = (v, lo, size) => Math.min(1, Math.max(0, (v - lo) / size));
  const K = kinds();
  for (const d of edgeDefs) {
    const e = d.spec, route = routes.get(d.id);
    const parent = commonParent(e.from, e.to);
    const pa = parent ? abs.get(parent) : { x: 0, y: 0 };
    let style = EDGE_STYLE + (white ? "labelBackgroundColor=#ffffff;" : "labelBackgroundColor=default;");
    if (e.dashed) style += "dashed=1;dashPattern=6 4;";
    if (e.both) style += "startArrow=block;startFill=1;";
    if (e.arrow === "none") style = styleSet(style, "endArrow", "none");
    if (e.color) style = styleSet(style, "strokeColor", K.palette[e.color].stroke);
    let geo = "";
    if (route) {
      const pts = route.pts, start = pts[0], end = pts[pts.length - 1], bends = pts.slice(1, -1);
      const s = abs.get(e.from), t = abs.get(e.to);
      style += `exitX=${+frac(start.x, s.x, s.w).toFixed(4)};exitY=${+frac(start.y, s.y, s.h).toFixed(4)};exitDx=0;exitDy=0;` +
               `entryX=${+frac(end.x, t.x, t.w).toFixed(4)};entryY=${+frac(end.y, t.y, t.h).toFixed(4)};entryDx=0;entryDy=0;`;
      if (bends.length) geo += `<Array as="points">${bends.map(b => `<mxPoint x="${b.x - pa.x}" y="${b.y - pa.y}"/>`).join("")}</Array>`;
      if (route.center) {
        // draw.io puts an edge label at the midpoint of the line; the offset moves it to where room was reserved.
        let total = 0; const seg = [];
        for (let i = 0; i + 1 < pts.length; i++) { const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(L); total += L; }
        let half = total / 2, mid = pts[0];
        for (let i = 0; i < seg.length; i++) { if (half <= seg[i] || i === seg.length - 1) { const f = seg[i] ? Math.min(1, half / seg[i]) : 0; mid = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; break; } half -= seg[i]; }
        geo += `<mxPoint x="${Math.round(route.center.x - mid.x)}" y="${Math.round(route.center.y - mid.y)}" as="offset"/>`;
      }
    }
    cells.push(`<mxCell id="${escapeXml(d.id)}" value="${escapeXml(d.lines.map(escapeHtml).join("<br>"))}" style="${escapeXml(style)}" edge="1" source="${escapeXml(e.from)}" target="${escapeXml(e.to)}" parent="${escapeXml(parent ?? "1")}">` +
      `<mxGeometry relative="1" as="geometry">${geo}</mxGeometry></mxCell>`);
  }

  // ---- extent of everything drawn, and the white backdrop under it -------------------------------
  const ext = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  const grow = r => { ext.x1 = Math.min(ext.x1, r.x); ext.y1 = Math.min(ext.y1, r.y); ext.x2 = Math.max(ext.x2, r.x + r.w); ext.y2 = Math.max(ext.y2, r.y + r.h); };
  for (const a of abs.values()) grow(a);
  for (const l of leafLabels) grow(l.rect);
  for (const r of labelRects) grow(r);
  for (const { pts } of routes.values()) for (const q of pts) grow({ x: q.x, y: q.y, w: 0, h: 0 });
  if (titleLines.length) grow({ x: MARGIN, y: MARGIN, w: Math.max(blockSize(titleLines, 18, true).width + 16, 200), h: titleH - 10 });
  const back = { x: Math.floor(ext.x1) - BACKDROP_MARGIN, y: Math.floor(ext.y1) - BACKDROP_MARGIN };
  back.w = Math.ceil(ext.x2) + BACKDROP_MARGIN - back.x; back.h = Math.ceil(ext.y2) + BACKDROP_MARGIN - back.y;

  const name = (spec.title ?? "Architecture").replace(/\s+/g, " ").slice(0, 60);
  const c = catalog();
  const layers = white
    ? `<mxCell id="0"/>\n<mxCell id="${LAYER_ID}" value="Background" style="locked=1;" parent="0"/>\n` +
      `<mxCell id="${BOX_ID}" value="" style="${BACKDROP_STYLE}" vertex="1" parent="${LAYER_ID}"><mxGeometry x="${back.x}" y="${back.y}" width="${back.w}" height="${back.h}" as="geometry"/></mxCell>\n` +
      `<mxCell id="1" value="Diagram" parent="0"/>\n`
    : `<mxCell id="0"/>\n<mxCell id="1" parent="0"/>\n`;
  const theme = white ? 'adaptiveColors="none" background="#ffffff"' : 'adaptiveColors="auto"';
  const plain = `<mxfile host="drawio-architecture-skill" agent="drawio-architecture-skill; draw.io ${c.sources.drawio.version}" version="${c.sources.drawio.version}">\n` +
    `<diagram id="page-1" name="${escapeXml(name)}">\n<mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0" ${theme}>\n<root>\n` +
    layers + cells.join("\n") + `\n</root>\n</mxGraphModel>\n</diagram>\n</mxfile>\n`;
  // Page properties, kept on the root cell: what the diagram is about, the spec it came from, and a hash
  // of the drawing as built (see meta.mjs). None of it is drawn; draw.io shows it under Edit Data.
  const { description, ...rest } = spec;                       // the description has its own property, so it is stored once
  const props = `<object label="" description="${escapeXml(description.replace(/\r\n?/g, "\n").trim())}" generator="${GENERATOR}" spec="${escapeXml(JSON.stringify(rest))}" ` +
    `fingerprint="${fingerprint(readDrawio(plain).pages[0].model)}" id="0"><mxCell/></object>`;
  const xml = plain.replace('<mxCell id="0"/>', () => props);
  return { xml, warnings, stats: { nodes: nodes.length, groups: groups.length, edges: edges.length, width: back.w, height: back.h, background: white ? "white" : "none" } };
}

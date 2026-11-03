// What a diagram is about, stored in the file itself.
//
// draw.io lets a page carry its own properties: they live on the page's root cell, which is
// then written as <object label="" name="value" ... id="0"><mxCell/></object>. They are not
// drawn, draw.io keeps them when it saves, and a person can read and change them in draw.io
// with nothing selected through Edit > Edit Data. This skill uses four of them:
//
//   description   what the diagram shows and how the system works, in plain sentences
//   generator     set when this skill built the page
//   spec          the JSON spec the page was built from
//   fingerprint   a hash of the shapes and edges as built, to tell later whether someone has
//                 changed the drawing by hand since (in which case the spec no longer matches it)
import { createHash } from "node:crypto";

export const GENERATOR = "drawio-architecture-skill";
export const MAX_DESCRIPTION = 2000;

const child = (el, name) => el && el.children.find(c => c.name === name);
const cellOf = el => (el.name === "mxCell" ? el : child(el, "mxCell"));
const NUMERIC = new Set(["x", "y", "width", "height"]);

/** The element that holds the page's root cell (the cell without a parent), or null. */
export function rootElement(model) {
  const root = child(model, "root");
  return (root && root.children.find(el => { const c = cellOf(el); return c && c.attrs.parent == null && c.attrs.vertex !== "1" && c.attrs.edge !== "1"; })) ?? null;
}

// The hash must not change when draw.io merely opens and saves the file. On saving, draw.io
// leaves out geometry numbers that are zero, writes cells grouped under their parents instead
// of in the order they were given, and may reorder the parts of a geometry. So numbers are
// compared by value with zero the same as absent, and cells and geometry parts are sorted.
// The order of waypoints inside a route is kept, because there it carries meaning.
function shape(el) {
  const attrs = Object.keys(el.attrs).sort().flatMap(k => {
    if (!NUMERIC.has(k)) return [[k, el.attrs[k]]];
    const n = Math.round(Number(el.attrs[k]) * 1000) / 1000;
    return n ? [[k, n]] : [];
  });
  const kids = el.children.map(shape);
  if (el.name === "mxGeometry") kids.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return [el.name, attrs, kids];
}

/** A short hash of everything drawn on the page: each shape and edge with its label, style, parent, ends and geometry. */
export function fingerprint(model) {
  const root = child(model, "root");
  const rows = [];
  for (const el of root ? root.children : []) {
    const cell = cellOf(el);
    if (!cell || (cell.attrs.vertex !== "1" && cell.attrs.edge !== "1")) continue;
    const wrapped = el !== cell;
    const geo = child(cell, "mxGeometry");
    rows.push([wrapped ? el.attrs.id ?? cell.attrs.id : cell.attrs.id, cell.attrs.parent ?? "", cell.attrs.vertex === "1" ? "v" : "e", cell.attrs.source ?? "", cell.attrs.target ?? "",
      (wrapped ? el.attrs.label : cell.attrs.value) ?? "", cell.attrs.style ?? "", geo ? shape(geo) : null]);
  }
  rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}

/**
 * Reads the page properties.
 * built: this skill built the page. edited: the drawing differs from what was built (null when unknown).
 * spec: the embedded spec as an object, or null when there is none or it cannot be read.
 */
export function readMeta(model) {
  const el = model && rootElement(model);
  const a = el && el.name !== "mxCell" ? el.attrs : {};
  const description = typeof a.description === "string" && a.description.trim() ? a.description.trim() : null;
  const built = a.generator === GENERATOR;
  let spec = null;
  if (built && typeof a.spec === "string") { try { const s = JSON.parse(a.spec); if (s && typeof s === "object" && !Array.isArray(s)) spec = s; } catch { /* treated as absent */ } }
  const edited = built && a.fingerprint ? a.fingerprint !== fingerprint(model) : null;
  if (spec) { const { title, ...rest } = spec; spec = { ...(title != null ? { title } : {}), ...(description ? { description } : {}), ...rest }; }   // the current description, in the place a person expects it
  return { description, built, spec, edited };
}

/** One line on where a page came from and, so, how to change it. */
export function sourceLine(meta) {
  if (meta.built && meta.spec && meta.edited === false) return "built by this skill and not changed since: update it by changing its spec and rebuilding (spec command)";
  if (meta.built && meta.edited) return "built by this skill, then changed by hand: update it by editing the XML (rebuilding would discard the manual changes)";
  if (meta.built) return "built by this skill, but its spec cannot be read: update it by editing the XML";
  return "drawn by hand or with another tool: update it by editing the XML";
}

/** Sets or clears the description of a parsed page. Returns false when the page has no root cell. */
export function setDescription(model, text) {
  const root = child(model, "root"), el = rootElement(model);
  if (!root || !el) return false;
  const value = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  let holder = el;
  if (el.name === "mxCell") {                                   // wrap the bare root cell; the id moves to the wrapper
    const { id, ...rest } = el.attrs;
    holder = { name: "object", attrs: { label: "", id }, children: [{ ...el, attrs: rest }], text: "" };
    root.children[root.children.indexOf(el)] = holder;
  }
  const { id, ...others } = holder.attrs;
  delete others.description;
  holder.attrs = { ...others, ...(value ? { description: value } : {}), id };      // id last, as draw.io writes it
  return true;
}

/** Problems with a description, as text; empty when it is fine. */
export function descriptionProblems(text) {
  if (typeof text !== "string") return ["description must be text"];
  if (text.length > MAX_DESCRIPTION) return [`description is ${text.length} characters; keep it under ${MAX_DESCRIPTION} (a few sentences)`];
  return [];
}

// Gives every page of an existing .drawio file a white background that stays white
// whatever theme the file is opened in:
//   - a white box behind everything, in a locked layer so it is not selected or moved by accident,
//   - adaptiveColors="none", so draw.io's dark theme does not recolour the shapes,
//   - a white page colour, so the area around the box is white in the editor as well.
// The box is sized from the rendered diagram, so labels and edge routes are covered too.
import { readFileSync } from "node:fs";
import { readDrawio } from "./xml.mjs";
import { serializePages } from "./write.mjs";
import { checkFile } from "./check.mjs";
import { BACKDROP_MARGIN, BACKDROP_STYLE, BOX_ID, LAYER_ID } from "./build.mjs";

const cellOf = el => (el.name === "mxCell" ? el : el.children.find(c => c.name === "mxCell"));
const idOf = el => (el.name === "mxCell" ? el.attrs.id : el.attrs.id ?? cellOf(el)?.attrs.id);
const node = (name, attrs, children = []) => ({ name, attrs, children, text: "" });

/**
 * options: margin (px around the content), fit (true = also shrink a box that is larger than needed), offline.
 * Returns { xml, pages: [{ index, name, action, rect }] }. action is "added", "adopted", "resized", "unchanged" or "skipped".
 */
export async function addBackdrop(file, { margin = BACKDROP_MARGIN, fit = false, offline = false } = {}) {
  const doc = readDrawio(readFileSync(file, "utf8"));
  const report = await checkFile(file, { offline });
  if (!report.rendered) throw Object.assign(new Error("the file could not be rendered, so its size is not known: " + (report.incomplete ?? "no browser")), { code: "SETUP" });
  const pages = [];
  for (const page of doc.pages) {
    const seen = report.pages[page.index];
    const result = { index: page.index + 1, name: page.name, action: "skipped", rect: null, why: null };
    pages.push(result);
    const root = page.model && page.model.children.find(c => c.name === "root");
    const base = root && root.children.find(el => { const c = cellOf(el); return c && c.attrs.parent == null && c.attrs.vertex !== "1" && c.attrs.edge !== "1"; });
    if (!root || !base) { result.why = "the page has no root cell"; continue; }
    if (!seen || !seen.content) { result.why = "the page has nothing drawn on it"; continue; }

    const c = seen.content;
    let rect = { x: Math.floor(c.x) - margin, y: Math.floor(c.y) - margin };
    rect.w = Math.ceil(c.x + c.w) + margin - rect.x; rect.h = Math.ceil(c.y + c.h) + margin - rect.y;

    const ids = new Set(root.children.map(idOf));
    const unique = want => { let id = want; for (let n = 2; ids.has(id); n++) id = `${want}_${n}`; ids.add(id); return id; };
    let box = seen.background.id != null ? root.children.find(el => idOf(el) === seen.background.id) : null;
    const had = box ? seen.background.rect : null;
    if (had && !fit) {                                   // never shrink a box someone sized on purpose, unless asked to
      const x2 = Math.max(rect.x + rect.w, had.x + had.w), y2 = Math.max(rect.y + rect.h, had.y + had.h);
      rect = { x: Math.min(rect.x, had.x), y: Math.min(rect.y, had.y) };
      rect.w = x2 - rect.x; rect.h = y2 - rect.y;
    }
    const same = had && had.x === rect.x && had.y === rect.y && had.w === rect.w && had.h === rect.h;
    const themed = page.model.attrs.adaptiveColors === "none" && String(page.model.attrs.background ?? "").toLowerCase() === "#ffffff";

    if (box && seen.background.locked) result.action = same && themed ? "unchanged" : "resized";
    else {
      const layerId = unique(LAYER_ID);
      const layer = node("mxCell", { id: layerId, value: "Background", style: "locked=1;", parent: idOf(base) });
      if (box) { root.children.splice(root.children.indexOf(box), 1); cellOf(box).attrs.parent = layerId; result.action = "adopted"; }
      else {
        box = node("mxCell", { id: unique(BOX_ID), value: "", style: BACKDROP_STYLE, vertex: "1", parent: layerId }, [node("mxGeometry", { x: "0", y: "0", width: "0", height: "0", as: "geometry" })]);
        result.action = "added";
      }
      root.children.splice(root.children.indexOf(base) + 1, 0, layer, box);     // first layer = drawn first = behind everything
    }
    const geo = cellOf(box).children.find(g => g.name === "mxGeometry");
    Object.assign(geo.attrs, { x: String(rect.x), y: String(rect.y), width: String(rect.w), height: String(rect.h) });
    page.model.attrs.adaptiveColors = "none";
    page.model.attrs.background = "#ffffff";
    result.rect = rect; result.id = idOf(box);
  }
  return { xml: serializePages(doc.pages), pages };
}

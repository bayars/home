// A small, strict XML reader for .drawio files, written here so the skill needs
// no XML dependency. It rejects DOCTYPE declarations and unknown entities, which
// also rules out entity-expansion tricks in files of unknown origin.
import { inflateRawSync } from "node:zlib";

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const MAX_INFLATED = 64 * 1024 * 1024;

export class XmlError extends Error {
  constructor(message, line, column) { super(`${message} (line ${line}, column ${column})`); this.code = "XML"; this.line = line; this.column = column; }
}

export function parseXml(src) {
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const n = src.length;
  let i = 0;
  const fail = (msg, at = i) => {
    const before = src.slice(0, at);
    const line = before.split("\n").length;
    throw new XmlError(msg, line, at - before.lastIndexOf("\n"));
  };
  const decode = (s, at) => s.indexOf("&") < 0 ? s : s.replace(/&([^;&\s]*);?/g, (m, ent) => {
    if (!m.endsWith(";")) fail("unescaped & (write &amp;)", at);
    if (ent[0] === "#") {
      const cp = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) fail(`bad character reference &${ent};`, at);
      return String.fromCodePoint(cp);
    }
    if (!Object.prototype.hasOwnProperty.call(NAMED, ent)) fail(`unknown entity &${ent};`, at);
    return NAMED[ent];
  });
  const NAME = /[A-Za-z_][\w:.-]*/y;
  const ATTR = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  const END = /\s*(\/?)>/y;
  const doc = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [doc];
  let comments = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    const chunk = src.slice(i, lt < 0 ? n : lt);
    if (chunk) { if (stack.length === 1 && chunk.trim()) fail("text outside the root element"); stack[stack.length - 1].text += decode(chunk, i); }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith("<!--", i)) { const j = src.indexOf("-->", i + 4); if (j < 0) fail("comment is not closed"); comments++; i = j + 3; continue; }
    if (src.startsWith("<![CDATA[", i)) { const j = src.indexOf("]]>", i + 9); if (j < 0) fail("CDATA section is not closed"); stack[stack.length - 1].text += src.slice(i + 9, j); i = j + 3; continue; }
    if (src.startsWith("<?", i)) { const j = src.indexOf("?>", i + 2); if (j < 0) fail("processing instruction is not closed"); i = j + 2; continue; }
    if (src.startsWith("<!", i)) fail("DOCTYPE and other declarations are not allowed in a .drawio file");
    if (src[i + 1] === "/") {
      const j = src.indexOf(">", i);
      if (j < 0) fail("closing tag is not finished");
      const name = src.slice(i + 2, j).trim();
      if (stack.length < 2 || stack[stack.length - 1].name !== name) fail(`closing tag </${name}> does not match ` + (stack.length < 2 ? "anything" : `<${stack[stack.length - 1].name}>`));
      stack.pop(); i = j + 1; continue;
    }
    NAME.lastIndex = i + 1;
    const nm = NAME.exec(src);
    if (!nm) fail("unescaped < (write &lt;) or a malformed tag");
    const el = { name: nm[0], attrs: {}, children: [], text: "", pos: i };
    i = NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = i;
      const a = ATTR.exec(src);
      if (!a) break;
      const raw = a[2] ?? a[3];
      if (raw.indexOf("<") >= 0) fail(`unescaped < in attribute ${a[1]} (write &lt;)`, i);
      if (Object.prototype.hasOwnProperty.call(el.attrs, a[1])) fail(`attribute ${a[1]} appears twice on <${el.name}>`, i);
      el.attrs[a[1]] = decode(raw, i);
      i = ATTR.lastIndex;
    }
    END.lastIndex = i;
    const e = END.exec(src);
    if (!e) fail(`malformed attributes on <${el.name}> (check quotes and escaping)`);
    i = END.lastIndex;
    if (stack.length === 1 && doc.children.length) fail("more than one root element", el.pos);
    stack[stack.length - 1].children.push(el);
    if (!e[1]) stack.push(el);
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].name}> is never closed`, stack[stack.length - 1].pos);
  if (!doc.children.length) fail("the file contains no XML element", 0);
  return { root: doc.children[0], comments };
}

const child = (el, name) => el.children.find(c => c.name === name);

/**
 * Reads a .drawio file (mxfile with one or more pages, or a bare mxGraphModel).
 * Returns { pages: [{index, id, name, compressed, model}], comments }.
 */
export function readDrawio(text) {
  const { root, comments } = parseXml(text);
  const pages = [];
  if (root.name === "mxGraphModel") pages.push({ index: 0, id: null, name: "Page-1", compressed: false, model: root });
  else if (root.name === "mxfile") {
    root.children.filter(c => c.name === "diagram").forEach((d, index) => {
      let model = child(d, "mxGraphModel"), compressed = false;
      if (!model && d.text.trim()) {
        compressed = true;
        let xml;
        try { xml = decodeURIComponent(inflateRawSync(Buffer.from(d.text.trim(), "base64"), { maxOutputLength: MAX_INFLATED }).toString("utf8")); }
        catch (e) { throw Object.assign(new Error(`page ${index + 1}: the compressed diagram data cannot be read (${e.message})`), { code: "XML" }); }
        model = parseXml(xml).root;
        if (model.name !== "mxGraphModel") throw Object.assign(new Error(`page ${index + 1}: compressed data is not an mxGraphModel`), { code: "XML" });
      }
      pages.push({ index, id: d.attrs.id ?? null, name: d.attrs.name ?? `Page-${index + 1}`, compressed, model: model ?? null });
    });
    if (!pages.length) throw Object.assign(new Error("the mxfile has no <diagram> pages"), { code: "XML" });
  } else throw Object.assign(new Error(`this is not a draw.io file: the root element is <${root.name}>, expected <mxfile> or <mxGraphModel>`), { code: "XML" });
  return { pages, comments };
}

const num = v => (v == null || v === "" ? 0 : Number(v));

/** Flattens a page's cells. draw.io may wrap an mxCell in <object> or <UserObject>, which then carries id and label. */
export function listCells(model) {
  const rootEl = model && child(model, "root");
  if (!rootEl) return null;
  const cells = [];
  for (const el of rootEl.children) {
    const wrapper = el.name === "mxCell" ? null : el;
    const cell = wrapper ? child(wrapper, "mxCell") : el;
    if (!cell) continue;
    const a = cell.attrs, w = wrapper ? wrapper.attrs : {};
    const g = child(cell, "mxGeometry");
    const pt = name => { const p = g && g.children.find(c => c.name === "mxPoint" && c.attrs.as === name); return p ? { x: num(p.attrs.x), y: num(p.attrs.y) } : null; };
    const arr = g && g.children.find(c => c.name === "Array" && c.attrs.as === "points");
    cells.push({
      id: w.id ?? a.id ?? null, parent: a.parent ?? null, value: w.label ?? a.value ?? "", style: a.style ?? "",
      vertex: a.vertex === "1", edge: a.edge === "1", source: a.source ?? null, target: a.target ?? null,
      geometry: g ? { x: num(g.attrs.x), y: num(g.attrs.y), width: num(g.attrs.width), height: num(g.attrs.height), relative: g.attrs.relative === "1",
        points: arr ? arr.children.filter(c => c.name === "mxPoint").map(p => ({ x: num(p.attrs.x), y: num(p.attrs.y) })) : [], sourcePoint: pt("sourcePoint"), targetPoint: pt("targetPoint") } : null,
    });
  }
  return cells;
}

export const styleMap = style => {
  const out = {};
  for (const part of String(style).split(";")) { if (!part) continue; const eq = part.indexOf("="); if (eq < 0) out[part] = true; else out[part.slice(0, eq)] = part.slice(eq + 1); }
  return out;
};

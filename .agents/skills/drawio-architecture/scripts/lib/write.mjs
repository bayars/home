// Writes parsed pages back out as plain (uncompressed) draw.io XML.
import { escapeXml } from "./text.mjs";

function element(el, depth) {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join("");
  const text = el.text.trim();
  if (!el.children.length && !text) return `${pad}<${el.name}${attrs}/>`;
  if (!el.children.length) return `${pad}<${el.name}${attrs}>${escapeXml(text)}</${el.name}>`;
  return `${pad}<${el.name}${attrs}>\n${el.children.map(c => element(c, depth + 1)).join("\n")}\n${pad}</${el.name}>`;
}

export function serializePages(pages) {
  const body = pages.map((p, i) => {
    const id = p.id ?? `page-${i + 1}`;
    const model = p.model ? element(p.model, 2) : "";
    return `  <diagram id="${escapeXml(id)}" name="${escapeXml(p.name)}">\n${model}\n  </diagram>`;
  }).join("\n");
  return `<mxfile host="drawio-architecture-skill">\n${body}\n</mxfile>\n`;
}

// Icon catalogue (assets/icons.json) and kind definitions (assets/kinds.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR } from "./paths.mjs";

let cat, kindDefs;
export function catalog() {
  if (!cat) cat = JSON.parse(readFileSync(join(ASSETS_DIR, "icons.json"), "utf8"));
  return cat;
}
export function kinds() {
  if (!kindDefs) kindDefs = JSON.parse(readFileSync(join(ASSETS_DIR, "kinds.json"), "utf8"));
  return kindDefs;
}

/** Exact lookup, following aliases. Returns {key, title, w, h, style} or null. */
export function resolveIcon(key) {
  const c = catalog();
  const real = c.icons[key] ? key : c.aliases[key];
  const e = real && c.icons[real];
  return e ? { key: real, title: e.t, w: e.w, h: e.h, style: e.s } : null;
}

const tokens = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Ranked search over keys, titles and tags. Every query word must match
 * something (prefix match), so "aws queue" finds aws.sqs.
 */
export function searchIcons(query, { provider, limit = 15 } = {}) {
  const c = catalog();
  const q = tokens(query);
  const aliasOf = {};
  for (const [a, t] of Object.entries(c.aliases)) (aliasOf[t] ||= []).push(a);
  const results = [];
  for (const [key, e] of Object.entries(c.icons)) {
    const prov = key.slice(0, key.indexOf("."));
    if (provider && prov !== provider) continue;
    const name = key.slice(prov.length + 1);
    const nameT = tokens(name), titleT = tokens(e.t), tagT = tokens(e.g || ""), aliasT = (aliasOf[key] || []).flatMap(a => tokens(a.slice(a.indexOf(".") + 1)));
    let score = 0, all = true;
    for (const w of q) {
      let s = 0;
      if (w === prov) s = 1;
      if (name === w) s = Math.max(s, 12);
      if (aliasT.includes(w)) s = Math.max(s, 10);
      if (nameT.includes(w)) s = Math.max(s, 8);
      if (titleT.includes(w)) s = Math.max(s, 7);
      if (nameT.some(t => t.startsWith(w)) || titleT.some(t => t.startsWith(w))) s = Math.max(s, 4);
      if (tagT.includes(w)) s = Math.max(s, 3);
      if (tagT.some(t => t.startsWith(w))) s = Math.max(s, 1.5);
      if (!s) { all = false; break; }
      score += s;
    }
    if (!all || !q.length) continue;
    score -= nameT.length * 0.3;                       // prefer the plain service over its sub-resources
    if (name.endsWith("_glyph")) score -= 0.5;
    results.push({ key, title: e.t, w: e.w, h: e.h, aliases: aliasOf[key] || [], score });
  }
  results.sort((a, b) => b.score - a.score || a.key.length - b.key.length || a.key.localeCompare(b.key));
  return results.slice(0, limit);
}

/** Suggestions for a key that does not exist. */
export function suggestIcons(key, limit = 5) {
  const dot = key.indexOf(".");
  const provider = dot > 0 ? key.slice(0, dot) : undefined;
  const words = tokens(dot > 0 ? key.slice(dot + 1) : key).join(" ");
  const known = new Set(Object.keys(catalog().icons).map(k => k.slice(0, k.indexOf("."))));
  let hits = searchIcons(words, { provider: known.has(provider) ? provider : undefined, limit });
  if (!hits.length) for (const w of tokens(words)) { hits = searchIcons(w, { provider: known.has(provider) ? provider : undefined, limit }); if (hits.length) break; }
  return hits.map(h => h.key);
}

export const providers = () => {
  const n = {};
  for (const k of Object.keys(catalog().icons)) { const p = k.slice(0, k.indexOf(".")); n[p] = (n[p] || 0) + 1; }
  return n;
};

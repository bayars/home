// check = structural lint + render in the real draw.io viewer + defect detection + PNG.
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { lintText } from "./lint.mjs";
import { startServer } from "./server.mjs";
import { launchBrowser } from "./browser.mjs";
import { manifest } from "./paths.mjs";

const MAX_FILE = 30 * 1024 * 1024;
const VIEW_LIMIT = 1500;          // images larger than this are scaled down when a model looks at them
const TILE = { w: 1400, h: 1000, overlap: 100 };
const MAX_SHOT = 15000;           // keep clear of Chromium's screenshot size limit

const count = findings => ({ error: findings.filter(f => f.severity === "error").length, warning: findings.filter(f => f.severity === "warning").length, info: findings.filter(f => f.severity === "info").length });

/**
 * Checks one .drawio file.
 * options: png (output path), scale (1-3), offline, ignore (array of finding kinds), render (false = structural only),
 *          theme ("light", or "dark" to draw the file as a dark-theme draw.io would)
 */
export async function checkFile(file, { png = null, scale = 1, offline = false, ignore = [], render = true, theme = "light" } = {}) {
  const abs = resolve(file);
  const size = statSync(abs).size;
  if (size > MAX_FILE) throw Object.assign(new Error(`${file} is ${(size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE / 1048576} MB`), { code: "USAGE" });
  const buffer = readFileSync(abs);
  const report = { file: abs, rendered: false, incomplete: null, pages: [], environment: { drawio: manifest().version }, counts: null };
  const keep = f => !ignore.includes(f.kind);

  let lint;
  try { lint = lintText(buffer.toString("utf8")); }
  catch (e) {
    if (e.code !== "XML") throw e;
    report.pages.push({ index: 1, name: "", findings: [{ severity: "error", kind: "xml", ids: [], message: "the file is not well-formed XML: " + e.message }] });
    report.counts = count(report.pages[0].findings);
    return report;
  }
  for (const p of lint.pages) report.pages.push({ index: p.index + 1, name: p.name, description: p.meta.description, built: p.meta.built, edited: p.meta.edited,
    findings: lint.findings.filter(f => f.page === p.index + 1).map(({ page, ...f }) => f) });
  const finish = () => {
    for (const p of report.pages) p.findings = p.findings.filter(keep);
    report.counts = count(report.pages.flatMap(p => p.findings));
    return report;
  };
  if (!render) { report.incomplete = "not rendered (structural checks only)"; return finish(); }

  const server = await startServer({ offline });
  let launched;
  try {
    try { launched = await launchBrowser({ proxyPort: server.port }); }
    catch (e) {
      if (e.code !== "NO_BROWSER") throw e;
      report.incomplete = "not rendered: " + e.message + ". Run the setup command. Structural checks only.";
      report.environment.browserAttempts = e.attempts;
      return finish();
    }
    const { browser } = launched;
    Object.assign(report.environment, { playwright: launched.playwright, browser: launched.browserVersion, sandbox: launched.sandbox });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Math.min(3, Math.max(1, scale)), serviceWorkers: "block", acceptDownloads: false });
    const routed = [];
    await context.route("**/*", route => {
      let u; try { u = new URL(route.request().url()); } catch { return route.abort(); }
      if (u.hostname === "127.0.0.1" && String(u.port) === String(server.port)) return route.continue();
      routed.push(u.href.slice(0, 300));
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e.message || e).split("\n")[0].slice(0, 300)));
    page.setDefaultTimeout(45000);
    await page.goto(server.origin + "/harness.html", { waitUntil: "load" });
    const ready = await page.evaluate(() => typeof window.drawioArch === "object" && typeof window.GraphViewer === "function");
    if (!ready) {
      const why = server.log.failed.length ? server.log.failed[0].error : (pageErrors[0] || "the viewer script did not load");
      throw Object.assign(new Error("the draw.io viewer could not be started: " + why), { code: "SETUP" });
    }
    const token = server.addDiagram(buffer);
    let names;
    report.environment.theme = theme;
    try { names = (await page.evaluate(([t, th]) => window.drawioArch.load(t, th), [token, theme])).pages; }
    catch (e) {
      report.pages[0].findings.push({ severity: "error", kind: "render-failed", ids: [], message: "draw.io could not render this file: " + String(e.message).split("\n")[0].slice(0, 300) });
      report.rendered = true;
      return finish();
    }
    report.rendered = true;
    const base = png ? resolve(png).replace(/\.png$/i, "") : null;
    if (base) mkdirSync(dirname(base), { recursive: true });
    for (let i = 0; i < names.length; i++) {
      const out = report.pages[i] ?? (report.pages[i] = { index: i + 1, name: names[i], findings: [] });
      const before = pageErrors.length;
      await page.evaluate(n => window.drawioArch.selectPage(n), i);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(120);
      let r;
      try { r = await page.evaluate(() => window.drawioArch.inspect()); }
      catch (e) { out.findings.push({ severity: "error", kind: "render-failed", ids: [], message: "page could not be inspected: " + String(e.message).split("\n")[0].slice(0, 300) }); continue; }
      Object.assign(out, { cells: r.cells, shapes: r.shapes, edges: r.edges, crossings: r.crossings, width: r.bounds.w, height: r.bounds.h, content: r.content, background: r.background });
      const seen = new Set(out.findings.map(f => f.kind + "|" + f.ids.join(",")));
      for (const f of r.findings) { const key = f.kind + "|" + f.ids.join(","); if (!seen.has(key)) { seen.add(key); out.findings.push(f); } }
      for (const msg of pageErrors.slice(before)) out.findings.push({ severity: "error", kind: "render-error", ids: [], message: "draw.io reported an error while drawing this page: " + msg });
      // images referenced by shapes
      const hosts = new Set();
      for (const im of r.images) {
        // The viewer resolves draw.io's own image paths against the check page, so strip that prefix again.
        const image = im.image.startsWith(server.origin + "/") ? im.image.slice(server.origin.length + 1) : im.image;
        if (image.startsWith("data:")) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(image) || image.startsWith("//")) { try { hosts.add(new URL(image, "https://x").host); } catch { hosts.add("another host"); } continue; }
        const rel = decodeURIComponent(image.replace(/^\/+/, "").split(/[?#]/)[0]);
        if (server.log.missing.includes(rel)) out.findings.push({ severity: "error", kind: "missing-image", ids: [im.id], message: `"${im.id}" uses image "${rel}", which is not part of draw.io ${manifest().version}` });
      }
      for (const u of [...r.blocked, ...routed, ...server.log.external]) { try { hosts.add(new URL(u).host || u); } catch { if (u) hosts.add(u.slice(0, 60)); } }
      hosts.delete(`127.0.0.1:${server.port}`);
      if (hosts.size && i === 0) out.findings.push({ severity: "info", kind: "external-resource", ids: [], message: "the file refers to content on other hosts (" + [...hosts].slice(0, 5).join(", ") + "); it was not loaded during the check, so it is missing from the picture" });

      if (base) {
        const stem = names.length > 1 && i > 0 ? `${base}-p${i + 1}` : base;
        out.images = await shoot(page, stem, Math.min(3, Math.max(1, scale)));
      }
    }
    if (server.log.failed.length) report.incomplete = "some draw.io files could not be obtained, so findings may be wrong: " + server.log.failed.slice(0, 3).map(f => `${f.rel} (${f.error})`).join("; ");
    await context.close();
    return finish();
  } finally {
    if (launched) await launched.browser.close().catch(() => {});
    await server.close();
  }
}

async function shoot(page, stem, dpr) {
  const images = { full: null, overview: null, tiles: [] };
  let clip = await page.evaluate(() => window.drawioArch.clip());
  const longest = Math.max(clip.width, clip.height);
  if (longest * dpr > MAX_SHOT) {                       // enormous diagram: the full image is scaled to stay within limits
    clip = await page.evaluate(s => window.drawioArch.setScale(s), MAX_SHOT / (longest * dpr));
  }
  const box = c => ({ x: c.x, y: c.y, width: c.width, height: c.height });
  images.full = { path: stem + ".png", width: Math.round(clip.width * dpr), height: Math.round(clip.height * dpr) };
  await page.screenshot({ path: images.full.path, clip: box(clip), fullPage: true });
  if (clip.scale !== 1) clip = await page.evaluate(() => window.drawioArch.setScale(1));
  if (Math.max(clip.width, clip.height) * dpr > VIEW_LIMIT) {
    // Tiles at full detail, plus a small overview, so nothing has to be judged from a shrunken image.
    // Tile sizes are in image pixels, so at --scale 2 each tile covers half as much of the diagram.
    const tw = Math.floor(TILE.w / dpr), th = Math.floor(TILE.h / dpr), ov = Math.floor(TILE.overlap / dpr);
    const stepX = tw - ov, stepY = th - ov;
    const cols = Math.max(1, Math.ceil((clip.width - ov) / stepX)), rows = Math.max(1, Math.ceil((clip.height - ov) / stepY));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = clip.x + c * stepX, y = clip.y + r * stepY;
      const w = Math.min(tw, clip.x + clip.width - x), h = Math.min(th, clip.y + clip.height - y);
      const path = `${stem}.tile-r${r + 1}c${c + 1}.png`;
      await page.screenshot({ path, clip: { x, y, width: w, height: h }, fullPage: true });
      images.tiles.push({ path, row: r + 1, col: c + 1, of: `${rows}x${cols}` });
    }
    const small = await page.evaluate(s => window.drawioArch.setScale(s), VIEW_LIMIT / (Math.max(clip.width, clip.height) * dpr));
    images.overview = { path: stem + ".overview.png", width: Math.round(small.width * dpr), height: Math.round(small.height * dpr) };
    await page.screenshot({ path: images.overview.path, clip: box(small), fullPage: true });
    await page.evaluate(() => window.drawioArch.setScale(1));
  }
  return images;
}

/** Plain-text report for a person or a model to read. */
export function formatReport(report, { cwd = process.cwd() } = {}) {
  const rel = p => (p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p);
  const lines = [];
  const mark = { error: "ERROR  ", warning: "WARNING", info: "note   " };
  for (const p of report.pages) {
    const dims = p.width != null ? `, ${p.shapes} shapes, ${p.edges} edges, ${p.width}x${p.height} px` + (p.crossings ? `, ${p.crossings} edge crossing${p.crossings === 1 ? "" : "s"}` : "") : "";
    lines.push(`${rel(report.file)} - page ${p.index}${p.name ? ` "${p.name}"` : ""}${dims}`);
    const order = { error: 0, warning: 1, info: 2 };
    for (const f of [...p.findings].sort((a, b) => order[a.severity] - order[b.severity])) lines.push(`  ${mark[f.severity]} ${f.kind}: ${f.message}`);
    if (!p.findings.length) lines.push("  no findings");
    if (p.images) {
      lines.push(`  image: ${rel(p.images.full.path)} (${p.images.full.width}x${p.images.full.height})`);
      if (p.images.overview) lines.push(`  too large to judge in one image. Look at the overview, then each tile: ${rel(p.images.overview.path)} + ${p.images.tiles.length} tiles (${rel(p.images.tiles[0].path)} ...)`);
    }
  }
  if (report.incomplete) lines.push("INCOMPLETE: " + report.incomplete);
  const c = report.counts;
  lines.push(c.error + c.warning === 0 ? `Result: clean${c.info ? ` (${c.info} note${c.info === 1 ? "" : "s"})` : ""}` : `Result: ${c.error} error${c.error === 1 ? "" : "s"}, ${c.warning} warning${c.warning === 1 ? "" : "s"}`);
  return lines.join("\n");
}

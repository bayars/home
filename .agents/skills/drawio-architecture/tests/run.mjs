#!/usr/bin/env node
// Test suite for the drawio-architecture skill.
//
//   node tests/run.mjs                 fast tests + render tests (render tests are skipped without a browser)
//   node tests/run.mjs --all-icons     also render every icon and every kind in the catalogue (downloads ~15 MB once)
//   node tests/run.mjs --network       also test download verification against a fresh temporary cache
//
// Run `node scripts/drawio-arch.mjs setup` first. Exit code 0 = everything that ran passed.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const tmp = mkdtempSync(join(tmpdir(), "drawio-arch-test-"));
const { parseXml, readDrawio } = await import("../scripts/lib/xml.mjs");
const { lintText, outline } = await import("../scripts/lib/lint.mjs");
const { lineWidth, wrap } = await import("../scripts/lib/text.mjs");
const { catalog, kinds, resolveIcon, searchIcons, suggestIcons } = await import("../scripts/lib/catalog.mjs");
const { manifest } = await import("../scripts/lib/paths.mjs");
const { buildDiagram, SpecError } = await import("../scripts/lib/build.mjs");
const { checkFile } = await import("../scripts/lib/check.mjs");
const { addBackdrop } = await import("../scripts/lib/backdrop.mjs");
const { fingerprint, readMeta, setDescription } = await import("../scripts/lib/meta.mjs");
const { scan, formatScan } = await import("../scripts/lib/scan.mjs");
const { serializePages } = await import("../scripts/lib/write.mjs");
const D = "A test diagram: one thing calls another.";       // every spec must say what it shows
const { findPlaywright, launchBrowser } = await import("../scripts/lib/browser.mjs");
const { prefetch } = await import("../scripts/lib/assets.mjs");

let haveBrowser = false, haveElk = true;
try { const b = await launchBrowser(); await b.browser.close(); haveBrowser = true; } catch { /* render tests are skipped */ }
try { await buildDiagram({ description: D, nodes: [{ id: "a" }] }); } catch (e) { if (e.code === "NO_ELK") haveElk = false; else throw e; }

const tests = [];
const test = (name, fn, { browser = false, elk = false, flag = null } = {}) => tests.push({ name, fn, browser, elk, flag });
const examples = readdirSync(join(ROOT, "examples")).filter(f => f.endsWith(".json")).sort();
const kindsOf = report => new Set(report.pages.flatMap(p => p.findings).map(f => f.kind));
const serious = report => report.pages.flatMap(p => p.findings).filter(f => f.severity !== "info");
const specError = async spec => { try { await buildDiagram(spec); } catch (e) { if (e instanceof SpecError) return e.problems.join("\n"); throw e; } return null; };

// ---- no browser, no network -------------------------------------------------------------------
test("XML reader accepts draw.io files and rejects malformed or risky input", () => {
  assert.equal(parseXml('<a x="1 &amp; 2"><b/>t&#x41;</a>').root.attrs.x, "1 & 2");
  for (const bad of ["<a><b></a>", '<a x="1" x="2"/>', '<!DOCTYPE x [<!ENTITY e "x">]><a/>', "<a>&foo;</a>", '<a v="a<b"/>', "<a/><b/>", '<a v="x & y"/>', "", "<a>"])
    assert.throws(() => parseXml(bad), { code: "XML" }, "should reject: " + bad);
  assert.throws(() => readDrawio("<html/>"), { code: "XML" });
});

test("text measurement is in a sane range", () => {
  assert.ok(lineWidth("Availability zone a") > 90 && lineWidth("Availability zone a") < 120);
  assert.deepEqual(wrap("one two three", 1000), ["one two three"]);
  assert.ok(wrap("A very long service name that will not fit", 120).length >= 2);
});

test("catalogue: keys are well formed, aliases resolve, images and stencils are in the allowlist", () => {
  const c = catalog(), m = manifest();
  const keys = Object.keys(c.icons);
  assert.ok(keys.length > 2000, "catalogue looks too small");
  for (const k of keys) assert.match(k, /^(aws|azure|gcp|k8s|cisco|net)\.[a-z0-9_]+$/, k);
  for (const [a, t] of Object.entries(c.aliases)) { assert.ok(c.icons[t], `alias ${a} -> ${t}`); assert.ok(!c.icons[a], `alias ${a} shadows a real key`); }
  for (const [k, e] of Object.entries(c.icons)) {
    const img = (/(?:^|;)image=([^;]+)/.exec(e.s) || [])[1];
    if (img) assert.ok(m.files[img], `${k}: ${img} is not in the manifest`);
    assert.ok(!/data:|https?:/.test(e.s), `${k}: style must not embed or link content`);
  }
  for (const f of ["js/viewer-static.min.js", "stencils/aws4.xml", "stencils/gcp2.xml", "stencils/kubernetes.xml", "stencils/kubernetes2.xml", "stencils/cisco19.xml", "stencils/networks.xml"]) assert.ok(m.files[f], f);
  assert.match(m.commit, /^[0-9a-f]{40}$/);
  assert.equal(c.sources.drawio.commit, m.commit, "catalogue and manifest must come from the same draw.io commit");
});

test("icon search and suggestions find common services", () => {
  assert.equal(resolveIcon("aws.alb").key, "aws.application_load_balancer");
  assert.equal(resolveIcon("k8s.deployment").key, "k8s.deploy");
  assert.equal(resolveIcon("aws.does_not_exist"), null);
  assert.equal(searchIcons("lambda")[0].key, "aws.lambda");
  assert.ok(searchIcons("gcp run").some(r => r.key === "gcp.cloud_run"));
  assert.ok(suggestIcons("azure.cosmos").includes("azure.azure_cosmos_db"));
});

test("kinds: every definition has the fields the build step needs", () => {
  const k = kinds();
  for (const [n, d] of Object.entries(k.nodes)) { assert.ok(d.s.endsWith(";") && d.desc, n); assert.ok(d.label === "below" ? d.w && d.h : d.minW && d.minH, n); }
  for (const [n, d] of Object.entries(k.groups)) { assert.ok(d.s.endsWith(";") && d.desc && d.top >= 20 && d.inset >= 0 && ["left", "center"].includes(d.align), n); }
});

test("build: spec problems are all reported, with suggestions", async () => {
  const msg = await specError({ nodes: [{ id: "a", icon: "aws.lambda_fn" }, { id: "a" }, { id: "b", parent: "nope" }, { id: "9x" }, { id: "c", colour: "red" }],
    groups: [{ id: "g", kind: "aws.nothing" }], edges: [{ from: "a", to: "zz" }, { from: "b", to: "b" }], extra: 1 });
  for (const part of ['unknown top-level field "extra"', 'unknown icon "aws.lambda_fn"', "aws.lambda", "used more than once", 'parent "nope" does not exist', "id must start with a letter", 'unknown field "colour"', 'unknown group kind "aws.nothing"', 'to "zz" is not the id', "from and to are the same"])
    assert.ok(msg.includes(part), "missing message: " + part + "\n" + msg);
  assert.ok((await specError({ nodes: [{ id: "n" }], groups: [{ id: "g1", parent: "g2" }, { id: "g2", parent: "g1" }] })).includes("loops back"));
  assert.ok((await specError({ nodes: [] })).includes("non-empty"));
  // A diagram must say what it shows.
  assert.ok(msg.includes('"description" is missing'));
  assert.ok((await specError({ description: "too short", nodes: [{ id: "n" }] })).includes("description is too short"));
  assert.ok((await specError({ description: 7, nodes: [{ id: "n" }] })).includes("description must be text"));
  assert.ok((await specError({ description: "x".repeat(2001), nodes: [{ id: "n" }] })).includes("keep it under 2000"));
  assert.equal(await specError({ description: D, nodes: [{ id: "n" }] }), null);
}, { elk: true });

test("build: labels with markup characters are escaped, never interpreted", async () => {
  const { xml } = await buildDiagram({ title: 'T <b>&"', description: 'Says <b>"what"</b> & why,\non two lines.', nodes: [{ id: "a", label: '<script>alert(1)</script> & "q"' }, { id: "b", label: "x", icon: "aws.s3" }], edges: [{ from: "a", to: "b", label: "<i>" }] });
  assert.ok(!xml.includes("<script>") && xml.includes("&amp;lt;script&amp;gt;"), "label must be double-escaped (HTML inside an XML attribute)");
  assert.equal(lintText(xml).findings.length, 0);
  assert.equal(lintText(xml).pages[0].meta.description, 'Says <b>"what"</b> & why,\non two lines.', "the description comes back exactly as written");
}, { elk: true });

for (const f of examples) test(`build: examples/${f} produces structurally valid draw.io XML`, async () => {
  const spec = JSON.parse(readFileSync(join(ROOT, "examples", f), "utf8"));
  const { xml, warnings } = await buildDiagram(spec);
  assert.deepEqual(warnings, []);
  const { findings, pages } = lintText(xml);
  assert.deepEqual(findings, []);
  // one vertex per node, group and title, plus the white background box
  assert.equal(pages[0].cells.filter(c => c.vertex).length, spec.nodes.length + (spec.groups?.length ?? 0) + (spec.title ? 1 : 0) + 1);
  assert.equal(pages[0].cells.filter(c => c.edge).length, spec.edges.length);
  assert.ok(outline(xml).includes(spec.nodes[0].id));
  // The file says what it shows and carries the spec it was built from; neither is a drawn cell.
  const meta = pages[0].meta;
  assert.equal(meta.description, spec.description);
  assert.ok(spec.description.length >= 200, "an example should show what a useful description looks like");
  assert.deepEqual([meta.built, meta.edited], [true, false]);
  assert.deepEqual(meta.spec, spec, "the embedded spec is the spec");
  assert.ok(!pages[0].cells.some(c => c.value.includes(spec.description.slice(0, 30))), "the description must not be drawn");
  assert.ok(outline(xml).includes("description: " + spec.description.slice(0, 40)));
  // Every shape states its own text colour, so nothing depends on the theme's default.
  for (const c of pages[0].cells.filter(c => c.vertex && c.id !== "backdrop")) assert.match(c.style, /fontColor=#/, `${c.id} has no explicit text colour`);
}, { elk: true });

test("build: the diagram sits on a white box in a locked layer behind everything", async () => {
  const spec = { title: "T", description: D, nodes: [{ id: "a", label: "A", parent: "g" }, { id: "b", label: "B", icon: "aws.s3" }], groups: [{ id: "g", label: "G" }], edges: [{ from: "a", to: "b", label: "calls" }] };
  const built = await buildDiagram(spec);
  const page = lintText(built.xml).pages[0], cells = page.cells;
  assert.deepEqual(page.layers, [{ id: "background_layer", name: "Background", locked: true }, { id: "1", name: "Diagram", locked: false }], "the locked background layer must come first (first layer = drawn at the back)");
  const box = cells.find(c => c.id === "backdrop");
  assert.equal(box.parent, "background_layer");
  assert.match(box.style, /fillColor=#ffffff/);
  assert.equal(cells.filter(c => c.parent === "background_layer").length, 1, "nothing else belongs in the background layer");
  assert.match(built.xml, /<mxGraphModel[^>]* adaptiveColors="none" background="#ffffff"/);
  assert.equal(built.stats.background, "white");
  assert.deepEqual([built.stats.width, built.stats.height], [box.geometry.width, box.geometry.height]);
  // the box holds every top-level shape with room to spare
  for (const c of cells.filter(c => c.vertex && c.parent === "1")) {
    const g = c.geometry, b = box.geometry;
    assert.ok(g.x >= b.x + 20 && g.y >= b.y + 20 && g.x + g.width <= b.x + b.width - 20 && g.y + g.height <= b.y + b.height - 20, `${c.id} is not inside the background box`);
  }
  assert.match(outline(built.xml), /layers, back to front: background_layer "Background" \(locked\), 1 "Diagram"\. New shapes go in "1"/);

  const plain = await buildDiagram({ ...spec, background: "none" });
  const plainPage = lintText(plain.xml).pages[0];
  assert.deepEqual(plainPage.layers.map(l => l.id), ["1"]);
  assert.ok(!plainPage.cells.some(c => c.id === "backdrop") && plain.xml.includes('adaptiveColors="auto"') && !plain.xml.includes(' background='));
  assert.ok((await specError({ ...spec, background: "black" })).includes('background must be "white" or "none"'));
  for (const id of ["backdrop", "background_layer", "diagram_title"]) assert.ok((await specError({ description: D, nodes: [{ id }] })).includes("reserved"), id + " should be reserved");
}, { elk: true });

test("lint: with a background layer present, advice still points at the drawing layer", () => {
  const xml = `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="bgl" value="Background" style="locked=1;" parent="0"/>
<mxCell id="bg" value="" style="rounded=0;fillColor=#ffffff;strokeColor=none;" vertex="1" parent="bgl"><mxGeometry width="600" height="300" as="geometry"/></mxCell><mxCell id="1" parent="0"/>
<mxCell id="g" value="Group" style="rounded=0;container=1;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="200" height="200" as="geometry"/></mxCell>
<mxCell id="a" value="A" style="rounded=1;html=1;" vertex="1" parent="g"><mxGeometry x="20" y="40" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="b" value="B" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="320" y="60" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="e" style="html=1;" edge="1" source="a" target="b" parent="g"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  const { findings, pages } = lintText(xml);
  assert.deepEqual(findings.map(f => f.kind), ["no-description", "edge-parent"]);
  assert.ok(findings[1].message.includes('set parent="1"'), findings[1].message);
  assert.deepEqual(pages[0].layers.map(l => [l.id, l.locked]), [["bgl", true], ["1", false]]);
  assert.ok(outline(xml).includes("(background, in a locked layer: leave it alone)"));
});

test("lint: structural defects in the fixture are found without a browser", () => {
  const got = new Set(lintText(readFileSync(join(ROOT, "tests/fixtures/defects.drawio"), "utf8")).findings.map(f => f.kind));
  for (const k of ["dangling-edge", "edge-no-geometry", "html-not-enabled", "literal-newline", "edge-parent"]) assert.ok(got.has(k), "expected " + k);
});

test("command line: usage errors exit with code 2, spec errors with code 1", () => {
  const run = (...a) => spawnSync(process.execPath, [join(ROOT, "scripts/drawio-arch.mjs"), ...a], { encoding: "utf8" });
  assert.equal(run("nonsense").status, 2);
  assert.equal(run("check", join(tmp, "missing.drawio")).status, 2);
  assert.equal(run("icons", "lambda").status, 0);
  writeFileSync(join(tmp, "bad.json"), JSON.stringify({ nodes: [{ id: "a", icon: "aws.nope" }] }));
  if (haveElk) assert.equal(run("build", join(tmp, "bad.json"), "-o", join(tmp, "bad.drawio")).status, 1);
});

test("description: stored on the page's root cell, readable and changeable without touching the drawing", () => {
  const bare = '<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="A" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
  const doc = readDrawio(bare);
  assert.deepEqual(readMeta(doc.pages[0].model), { description: null, built: false, spec: null, edited: null });
  const before = fingerprint(doc.pages[0].model);
  const text = 'Line one with "quotes", <tags> & an ampersand.\nLine two.';
  assert.ok(setDescription(doc.pages[0].model, text + "  \r\n"));
  const xml = serializePages(doc.pages);
  // draw.io's own form for page properties: an <object> around the root cell, id on the wrapper
  assert.match(xml, /<object label="" description="Line one with &quot;quotes&quot;, &lt;tags&gt; &amp; an ampersand\.&#xa;Line two\." id="0">\s*<mxCell\/>\s*<\/object>/);
  const again = readDrawio(xml);
  assert.equal(readMeta(again.pages[0].model).description, text);
  assert.equal(fingerprint(again.pages[0].model), before, "describing a page does not count as changing the drawing");
  assert.deepEqual(lintText(xml).findings, []);
  assert.deepEqual(lintText(bare).findings.map(f => f.kind), ["no-description"]);
  // changing and removing it; other properties a person added in draw.io are kept
  const custom = readDrawio(xml.replace('<object label=""', '<object label="" owner="platform team"'));
  setDescription(custom.pages[0].model, "Replaced.");
  assert.match(serializePages(custom.pages), /<object label="" owner="platform team" description="Replaced\." id="0">/);
  setDescription(custom.pages[0].model, "");
  assert.match(serializePages(custom.pages), /<object label="" owner="platform team" id="0">/);
  // draw.io sometimes writes <UserObject> instead of <object>
  assert.equal(readMeta(readDrawio(xml.replace("<object", "<UserObject").replace("</object>", "</UserObject>")).pages[0].model).description, text);
});

test("fingerprint: unchanged by what draw.io rewrites on save, changed by a real edit", async () => {
  const spec = JSON.parse(readFileSync(join(ROOT, "examples", "aws-web-app.json"), "utf8"));
  const { xml } = await buildDiagram(spec);
  const meta = x => readMeta(readDrawio(x).pages[0].model);
  assert.equal(meta(xml).edited, false);
  // What draw.io does to a file it opens and saves, as observed in the 31.7.0 editor: cells are written grouped under
  // their parents, attributes are reordered, zero coordinates are dropped, and geometry parts change order.
  const doc = readDrawio(xml), root = doc.pages[0].model.children.find(c => c.name === "root");
  const idOf = el => el.attrs.id, cellOf = el => (el.name === "mxCell" ? el : el.children[0]);
  const byParent = new Map();
  for (const el of root.children) { const p = cellOf(el).attrs.parent ?? ""; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(el); }
  const ordered = []; (function walk(p) { for (const el of byParent.get(p) ?? []) { ordered.push(el); walk(idOf(el)); } })("");
  assert.equal(ordered.length, root.children.length);
  assert.notDeepEqual(ordered.map(idOf), root.children.map(idOf), "the test should really reorder something");
  root.children = ordered;
  for (const el of ordered) {
    const cell = cellOf(el);
    cell.attrs = Object.fromEntries(Object.entries(cell.attrs).reverse());
    const geo = cell.children.find(c => c.name === "mxGeometry");
    if (!geo) continue;
    for (const k of ["x", "y"]) if (Number(geo.attrs[k]) === 0) delete geo.attrs[k];
    for (const k of ["width", "height"]) if (geo.attrs[k] != null) geo.attrs[k] = Number(geo.attrs[k]).toFixed(1);
    geo.children.reverse();
  }
  doc.pages[0].model.attrs.dx = "1837";
  const saved = serializePages(doc.pages);
  assert.equal(meta(saved).edited, false, "opening and saving in draw.io is not an edit");
  assert.deepEqual(meta(saved).spec, spec);
  // Real edits: a shape moved, a label changed, a waypoint order swapped, a shape deleted.
  assert.equal(meta(xml.replace(/(<mxCell id="users"[^>]*><mxGeometry x=")(\d+)/, (m, a, x) => a + (Number(x) + 10))).edited, true);
  assert.equal(meta(xml.replace('value="Route 53"', 'value="Route 53 (DNS)"')).edited, true);
  assert.equal(meta(xml.replace(/<Array as="points">(<mxPoint [^>]*\/>)(<mxPoint [^>]*\/>)/, '<Array as="points">$2$1')).edited, true);
  assert.equal(meta(xml.replace(/<mxCell id="s3"[\s\S]*?<\/mxCell>\n/, "")).edited, true);
  // A page that says it was built but has lost its fingerprint is not trusted to be unchanged.
  assert.equal(meta(xml.replace(/ fingerprint="[0-9a-f]+"/, "")).edited, null);
}, { elk: true });

test("scan: existing diagrams are found and summarised; dependency, hidden and linked folders are not entered", async () => {
  const proj = join(tmp, "proj");
  for (const d of ["docs/arch", "docs/old", "node_modules/pkg", ".git/x", "dist"]) mkdirSync(join(proj, d), { recursive: true });
  const spec = JSON.parse(readFileSync(join(ROOT, "examples", "aws-web-app.json"), "utf8"));
  const built = (await buildDiagram(spec)).xml;
  writeFileSync(join(proj, "docs/arch/orders.drawio"), built);
  writeFileSync(join(proj, "docs/arch/orders-moved.drawio"), built.replace('value="Route 53"', 'value="Route 53 (DNS)"'));
  copyFileSync(join(ROOT, "tests/fixtures/handmade-backdrop.drawio"), join(proj, "docs/old/legacy.dio"));
  writeFileSync(join(proj, "docs/broken.drawio"), "not xml at all");
  writeFileSync(join(proj, "docs/picture.drawio.svg"), "<svg/>");
  writeFileSync(join(proj, "docs/notes.md"), "# not a diagram");
  for (const d of ["node_modules/pkg", ".git/x", "dist"]) writeFileSync(join(proj, d, "copy.drawio"), built);
  try { symlinkSync(join(proj, "docs/arch"), join(proj, "linked")); } catch { /* no symlinks on this platform */ }

  const result = scan(["."], { cwd: proj });
  assert.deepEqual(result.files.map(f => f.path.replace(/\\/g, "/")), ["docs/arch/orders-moved.drawio", "docs/arch/orders.drawio", "docs/broken.drawio", "docs/old/legacy.dio"]);
  assert.deepEqual(result.embedded.map(f => f.replace(/\\/g, "/")), ["docs/picture.drawio.svg"]);
  const [moved, orders, broken, legacy] = result.files;
  assert.match(broken.error, /not a readable draw\.io file/);
  const p = orders.pages[0];
  assert.deepEqual([p.name, p.description, p.built, p.edited, p.hasSpec, p.shapes, p.edges, p.icons], ["Orders platform: AWS deployment", spec.description, true, false, true, 22, 15, ["AWS"]]);
  assert.ok(p.boundaries.includes("VPC 10.0.0.0/16") && p.components.includes("RDS primary") && !p.components.includes(spec.title), "labels are split into boundaries and components; the title is neither");
  assert.equal(moved.pages[0].edited, true);
  assert.deepEqual([legacy.pages[0].description, legacy.pages[0].built, legacy.pages[0].components], [null, false, ["Web app", "API", "Database", "Cache"]]);
  const text = formatScan(result);
  assert.match(text, /^4 draw\.io files under \.: 3 pages, 2 with a description\./);
  assert.match(text, /orders\.drawio {3}\(modified \d{4}-\d\d-\d\d\)\n {2}page 1 "Orders platform: AWS deployment": 22 shapes, 15 edges, AWS icons\n {4}description: Production deployment/);
  assert.match(text, /built by this skill and not changed since: update it by changing its spec and rebuilding/);
  assert.match(text, /built by this skill, then changed by hand: update it by editing the XML/);
  assert.match(text, /no description\. Contains: Web app, API, Database, Cache\.\n {4}drawn by hand or with another tool/);
  assert.match(text, /Not read \(diagrams saved inside a picture/);
  assert.match(formatScan(scan(["docs/notes.md"], { cwd: proj })), /not a readable draw\.io file/, "a file named directly is read whatever it is called");
  assert.match(formatScan(scan(["dist"], { cwd: proj })), /^1 draw\.io file under dist/, "a skipped folder can still be scanned by naming it");
  // Text from a file cannot break out of its line or bring control characters into the listing.
  writeFileSync(join(proj, "empty-ish.drawio"), '<mxfile><diagram id="p" name="N\u001b[2Jame"><mxGraphModel><root><object label="" description="First line.&#xa;&#xa;other.drawio   (modified 2026-01-01)&#xa;  page 1: not real" id="0"><mxCell/></object><mxCell id="1" parent="0"/><mxCell id="a" value="A" style="rounded=1;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
  const hostile = formatScan(scan(["empty-ish.drawio"], { cwd: proj }));
  assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(hostile) && hostile.split("\n").length === 6, "one header, one blank, and four lines for the file:\n" + hostile);
  assert.match(hostile, /description: First line\. other\.drawio {3}\(modified 2026-01-01\) +page 1: not real\n/);
  mkdirSync(join(proj, "empty"));
  assert.equal(formatScan(scan(["empty"], { cwd: proj })), "No draw.io files under empty.");
}, { elk: true });

test("command line: describe, spec, and the guard against building over a hand-made diagram", async () => {
  const dir = join(tmp, "cli"); mkdirSync(dir);
  const run = (args, input) => spawnSync(process.execPath, [join(ROOT, "scripts/drawio-arch.mjs"), ...args], { encoding: "utf8", cwd: dir, input });
  const spec = JSON.parse(readFileSync(join(ROOT, "examples", "software-services.json"), "utf8"));
  writeFileSync(join(dir, "s.json"), JSON.stringify(spec));
  copyFileSync(join(ROOT, "tests/fixtures/handmade-backdrop.drawio"), join(dir, "hand.drawio"));

  // a new diagram, then the normal fix-and-rebuild loop over the same file
  assert.equal(run(["build", "s.json", "-o", "orders.drawio"]).status, 0);
  assert.equal(run(["build", "s.json", "-o", "orders.drawio"]).status, 0, "rebuilding an untouched build is allowed");
  let r = run(["describe", "orders.drawio"]);
  assert.ok(r.stdout.includes("description: " + spec.description) && r.stdout.includes("built by this skill and not changed since"));
  // the spec comes back out of the file, description included
  r = run(["spec", "orders.drawio", "-o", "back.json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "back.json"), "utf8")), spec);
  // updating: change the spec, rebuild over the diagram
  const changed = { ...spec, description: spec.description + " A Redis cache now sits in front of the Orders database.", nodes: [...spec.nodes, { id: "redis", label: "Orders cache", kind: "database", tech: "Redis", parent: "data" }], edges: [...spec.edges, { from: "orders", to: "redis" }] };
  writeFileSync(join(dir, "back.json"), JSON.stringify(changed));
  assert.equal(run(["build", "back.json", "-o", "orders.drawio"]).status, 0);
  assert.ok(run(["scan", "."]).stdout.includes("A Redis cache now sits in front"));

  // describe --set on a hand-made file, from an argument and from standard input
  r = run(["describe", "hand.drawio", "--set", "Web app, API, database and cache.", "-o", "hand.drawio"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(run(["describe", "hand.drawio"]).stdout, /description: Web app, API, database and cache\.\n {2}source: drawn by hand or with another tool/);
  assert.equal(run(["describe", "hand.drawio", "--set", "-", "-o", "hand2.drawio"], "From standard input,\nwith two lines.\n").status, 0);
  assert.equal(lintText(readFileSync(join(dir, "hand2.drawio"), "utf8")).pages[0].meta.description, "From standard input,\nwith two lines.");
  assert.equal(run(["describe", "hand.drawio", "--set", "x".repeat(2001), "-o", "hand.drawio"]).status, 1);
  assert.equal(run(["describe", "hand.drawio", "--set", "text"]).status, 2, "writing needs -o");

  // refusals: no spec in a hand-made file; a build must not replace hand-made or hand-edited drawings
  r = run(["spec", "hand.drawio", "-o", "x.json"]);
  assert.equal(r.status, 1); assert.match(r.stderr, /was not built by this skill/);
  r = run(["build", "s.json", "-o", "hand.drawio"]);
  assert.equal(r.status, 1); assert.match(r.stderr, /drawn by hand[\s\S]*add --overwrite/);
  assert.ok(readFileSync(join(dir, "hand.drawio"), "utf8").includes('id="bg"'), "the hand-made file is untouched");
  writeFileSync(join(dir, "orders.drawio"), readFileSync(join(dir, "orders.drawio"), "utf8").replace('value="Customer"', 'value="Shopper"'));
  r = run(["build", "back.json", "-o", "orders.drawio"]);
  assert.equal(r.status, 1); assert.match(r.stderr, /changed by hand after it was built/);
  r = run(["spec", "orders.drawio", "-o", "x.json"]);
  assert.equal(r.status, 1); assert.match(r.stderr, /rebuild would discard those changes/);
  assert.equal(run(["spec", "orders.drawio", "-o", "x.json", "--force"]).status, 0);
  assert.equal(run(["build", "back.json", "-o", "orders.drawio", "--overwrite"]).status, 0);

  // several pages: commands that act on one page ask which
  const two = readDrawio(readFileSync(join(dir, "hand.drawio"), "utf8"));
  two.pages.push({ ...two.pages[0], index: 1, id: "second", name: "Second" });
  writeFileSync(join(dir, "two.drawio"), serializePages(two.pages));
  r = run(["describe", "two.drawio", "--set", "Only the second page.", "-o", "two.drawio"]);
  assert.equal(r.status, 2); assert.match(r.stderr, /has 2 pages; say which one to describe with --page N/);
  assert.equal(run(["describe", "two.drawio", "--page", "3"]).status, 2);
  r = run(["build", "s.json", "-o", "two.drawio"]);
  assert.equal(r.status, 1); assert.match(r.stderr, /has 2 pages/);
}, { elk: true });

test("docs: the example in SKILL.md builds, and the references name every kind and finding", async () => {
  const skill = readFileSync(join(ROOT, "SKILL.md"), "utf8");
  assert.ok(skill.split("\n").length < 500, "SKILL.md should stay under 500 lines");
  const block = /```json\n([\s\S]*?)```/.exec(skill)[1];
  const { xml } = await buildDiagram(JSON.parse(block));
  assert.deepEqual(lintText(xml).findings, []);
  const spec = readFileSync(join(ROOT, "references/spec.md"), "utf8"), k = kinds();
  for (const name of [...Object.keys(k.nodes), ...Object.keys(k.groups), ...Object.keys(k.palette)]) assert.ok(spec.includes("`" + name + "`"), "references/spec.md does not mention " + name);
  const findings = readFileSync(join(ROOT, "references/findings.md"), "utf8");
  const code = ["assets/viewer/inspect.js", "scripts/lib/lint.mjs", "scripts/lib/check.mjs"].map(f => readFileSync(join(ROOT, f), "utf8")).join("\n");
  const kindNames = new Set([...code.matchAll(/(?:add\((?:page, )?"(?:error|warning|info)", |kind: )"([a-z-]+)"/g)].map(m => m[1]));
  for (const name of [...kindNames, "edge-no-geometry", "vertex-no-geometry"]) assert.ok(findings.includes("`" + name + "`"), "references/findings.md does not explain " + name);
  assert.ok(kindNames.size >= 35);
}, { elk: true });

// ---- render tests --------------------------------------------------------------------------------
for (const f of examples) test(`render: examples/${f} is clean in the draw.io viewer`, async () => {
  const { xml } = await buildDiagram(JSON.parse(readFileSync(join(ROOT, "examples", f), "utf8")));
  const file = join(tmp, f.replace(".json", ".drawio"));
  writeFileSync(file, xml);
  const report = await checkFile(file, { png: file.replace(".drawio", ".png") });
  assert.equal(report.rendered, true); assert.equal(report.incomplete, null);
  assert.deepEqual(report.pages[0].findings.map(x => x.kind + ": " + x.message), [], "a built example must have no findings at all, notes included");
  assert.ok(statSync(report.pages[0].images.full.path).size > 5000, "PNG looks empty");
  // The background box, as measured in the rendered page: locked, white, and wider than everything drawn.
  const { background: bg, content: c } = report.pages[0];
  assert.deepEqual([bg.id, bg.locked, bg.drawnAs, bg.adaptiveColors, bg.pageColor, bg.recoloured], ["backdrop", true, "rgb(255, 255, 255)", "none", "#ffffff", 0]);
  const gap = Math.min(c.x - bg.rect.x, c.y - bg.rect.y, bg.rect.x + bg.rect.w - (c.x + c.w), bg.rect.y + bg.rect.h - (c.y + c.h));
  assert.ok(gap >= 10, `the rendered diagram comes within ${gap} px of the edge of the background box`);
  assert.equal(report.pages[0].shapes, lintText(xml).pages[0].cells.filter(x => x.vertex).length - 1, "the background box is not counted as a shape");
}, { browser: true, elk: true });

test("render: a built diagram looks the same in draw.io's dark theme; without the background it does not", async () => {
  const spec = JSON.parse(readFileSync(join(ROOT, "examples", "aws-web-app.json"), "utf8"));
  const white = join(tmp, "theme-white.drawio"), none = join(tmp, "theme-none.drawio");
  writeFileSync(white, (await buildDiagram(spec)).xml);
  writeFileSync(none, (await buildDiagram({ ...spec, background: "none" })).xml);
  const dark = await checkFile(white, { theme: "dark", png: join(tmp, "theme-white-dark.png") });
  assert.equal(dark.environment.theme, "dark");
  assert.deepEqual(dark.pages[0].findings, []);
  assert.deepEqual([dark.pages[0].background.drawnAs, dark.pages[0].background.recoloured], ["rgb(255, 255, 255)", 0]);
  const adaptive = await checkFile(none, { theme: "dark" });
  assert.deepEqual(serious(adaptive), []);
  assert.equal(adaptive.pages[0].background.id, null);
  assert.ok(adaptive.pages[0].background.recoloured > 50, "an adaptive diagram should be recoloured by the dark theme");
  assert.ok(adaptive.pages[0].findings.some(f => f.kind === "background" && f.severity === "info"));
  assert.deepEqual((await checkFile(none, { ignore: ["background"] })).pages[0].findings, []);
}, { browser: true, elk: true });

test("backdrop: a hand-drawn background box is recognised, then moved to a locked layer and resized", async () => {
  const src = join(ROOT, "tests/fixtures/handmade-backdrop.drawio");
  const before = await checkFile(src, { theme: "dark" });
  // The box is scenery: no overlap findings, but the shape that sticks out of it is reported.
  assert.deepEqual(serious(before).map(f => f.kind), ["outside-backdrop"]);
  assert.deepEqual(serious(before)[0].ids, ["cache"]);
  const b = before.pages[0].background;
  assert.deepEqual([b.id, b.locked, before.pages[0].shapes], ["bg", false, 4]);
  assert.notEqual(b.drawnAs, "rgb(255, 255, 255)", "draw.io's dark theme recolours a plain white box");
  assert.ok(before.pages[0].findings.some(f => f.kind === "background" && f.message.includes("ordinary shape")));

  const out = join(tmp, "hand-fixed.drawio");
  const result = await addBackdrop(src);
  writeFileSync(out, result.xml);
  assert.deepEqual(result.pages.map(p => [p.action, p.id]), [["adopted", "bg"]]);
  assert.deepEqual(result.pages[0].rect, { x: 0, y: 0, w: 620, h: 350 }, "grown downwards to cover the cache box, never shrunk");
  const page = lintText(result.xml).pages[0];
  assert.deepEqual(page.layers.map(l => [l.id, l.locked]), [["background_layer", true], ["1", false]]);
  assert.equal(page.cells.find(c => c.id === "bg").parent, "background_layer");
  assert.equal(page.cells.filter(c => c.vertex).length, 5, "no second box is added");
  assert.deepEqual((await checkFile(out)).pages[0].findings.map(f => f.kind), ["no-description"], "the only thing left to say is that the page does not describe itself");
  const described = readDrawio(readFileSync(out, "utf8"));
  assert.ok(setDescription(described.pages[0].model, "Web app, API, database and cache of the legacy shop."));
  writeFileSync(out, serializePages(described.pages));
  for (const theme of ["light", "dark"]) {
    const after = await checkFile(out, { theme });
    assert.deepEqual(after.pages[0].findings, [], theme);
    assert.deepEqual([after.pages[0].background.locked, after.pages[0].background.drawnAs, after.pages[0].background.recoloured], [true, "rgb(255, 255, 255)", 0], theme);
  }
  assert.deepEqual((await addBackdrop(out)).pages.map(p => p.action), ["unchanged"]);
  assert.deepEqual((await addBackdrop(out, { fit: true, margin: 30 })).pages[0].rect, { x: 10, y: 70, w: 580, h: 290 });
}, { browser: true });

test("backdrop: files without a background get one on every page, compressed pages included", async () => {
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="backdrop" value="Not a background" style="rounded=1;html=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="60" as="geometry"/></mxCell>' +
    '<mxCell id="y" value="Other" style="rounded=1;html=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="300" y="40" width="120" height="60" as="geometry"/></mxCell><mxCell id="e" value="uses" style="html=1;" edge="1" source="backdrop" target="y" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>';
  const file = join(tmp, "no-background.drawio");
  writeFileSync(file, `<mxfile><diagram id="p1" name="Packed">${deflateRawSync(encodeURIComponent(model)).toString("base64")}</diagram><diagram id="p2" name="Plain">${model.replace('id="backdrop"', 'id="x"').replace('source="backdrop"', 'source="x"')}</diagram><diagram id="p3" name="Empty"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`);
  const result = await addBackdrop(file);
  // An id that is already taken is not reused; an empty page is left alone.
  assert.deepEqual(result.pages.map(p => [p.action, p.id ?? null]), [["added", "backdrop_2"], ["added", "backdrop"], ["skipped", null]]);
  assert.deepEqual(result.pages[0].rect, { x: 20, y: 20, w: 420, h: 100 });
  const out = join(tmp, "with-background.drawio"); writeFileSync(out, result.xml);
  assert.deepEqual(lintText(result.xml).findings.map(f => f.kind), ["no-description", "no-description", "empty-page"]);
  const report = await checkFile(out, { theme: "dark", ignore: ["no-description"] });
  for (const p of report.pages.slice(0, 2)) { assert.deepEqual(p.findings, []); assert.deepEqual([p.background.locked, p.background.drawnAs, p.shapes], [true, "rgb(255, 255, 255)", 2]); }
  // The command-line form, writing over its input.
  const run = spawnSync(process.execPath, [join(ROOT, "scripts/drawio-arch.mjs"), "backdrop", file, "-o", file, "--check"], { encoding: "utf8" });
  assert.equal(run.status, 1, run.stdout + run.stderr);                   // the empty third page is a warning
  assert.match(run.stdout, /page 1 "Packed": added a white background box "backdrop_2", 420x100 px at 20,20/);
  assert.match(run.stdout, /page 3 "Empty": skipped \(the page has nothing drawn on it\)/);
}, { browser: true });

test("render: every deliberate defect in the fixture is reported", async () => {
  const report = await checkFile(join(ROOT, "tests/fixtures/defects.drawio"));
  const got = kindsOf(report);
  for (const k of ["unknown-shape", "unknown-icon", "missing-image", "dangling-edge", "edge-no-geometry", "html-not-enabled", "literal-newline", "edge-parent", "label-overflow",
    "label-outside-container", "title-wraps", "child-outside-container", "overlaps-container", "container-overlap", "overlap", "label-over-label", "label-over-node", "edge-through-node", "edge-overlap", "external-resource"])
    assert.ok(got.has(k), "expected a finding of kind " + k);
  assert.ok(report.counts.error >= 7 && report.counts.warning >= 15);
}, { browser: true });

test("render: nothing outside this machine is contacted, even when the file asks for it", async () => {
  const xml = `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="&lt;img src=&quot;https://tracker.invalid/pixel.gif&quot;&gt;x&lt;script&gt;fetch('https://tracker.invalid/js')&lt;/script&gt;" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="remote" style="shape=image;html=1;image=https://tracker.invalid/logo.png;" vertex="1" parent="1"><mxGeometry x="260" y="20" width="60" height="60" as="geometry"/></mxCell>
<mxCell id="c" value="css" style="rounded=1;html=1;fontFamily=Lobster;fontSource=https%3A%2F%2Ftracker.invalid%2Ffont.css;" vertex="1" parent="1"><mxGeometry x="400" y="20" width="100" height="60" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;
  const file = join(tmp, "external.drawio"); writeFileSync(file, xml);
  const report = await checkFile(file);
  assert.equal(report.rendered, true);
  const note = report.pages[0].findings.find(f => f.kind === "external-resource");
  assert.ok(note && note.message.includes("tracker.invalid"), "blocked content should be reported");
  assert.equal(report.counts.error, 0);
}, { browser: true });

test("render: compressed, multi-page files are handled", async () => {
  const { xml } = await buildDiagram(JSON.parse(readFileSync(join(ROOT, "examples", examples[0]), "utf8")));
  const model = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(xml)[0];
  const packed = deflateRawSync(encodeURIComponent(model)).toString("base64");
  const second = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="x" value="Second page" style="rounded=1;html=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';
  const file = join(tmp, "two-pages.drawio");
  writeFileSync(file, `<mxfile><diagram id="p1" name="One">${packed}</diagram><diagram id="p2" name="Two">${second}</diagram></mxfile>`);
  assert.ok(outline(readFileSync(file, "utf8")).includes('Page 2 "Two"'));
  const report = await checkFile(file, { png: join(tmp, "two-pages.png") });
  assert.equal(report.pages.length, 2);
  assert.deepEqual(serious(report), []);
  assert.ok(report.pages[0].shapes > 5 && report.pages[1].shapes === 1);
  assert.ok(statSync(join(tmp, "two-pages-p2.png")).size > 500);
}, { browser: true, elk: true });

test("render: a file that is not XML is reported, not crashed on", async () => {
  const file = join(tmp, "broken.drawio"); writeFileSync(file, "<mxfile><diagram><mxGraphModel><root><mxCell id=\"0\"></root></mxGraphModel></diagram></mxfile>");
  const report = await checkFile(file);
  assert.equal(report.rendered, false);
  assert.equal(report.pages[0].findings[0].kind, "xml");
}, { browser: true });

test("render: script and event handlers inside a label do not run", async () => {
  const { startServer } = await import("../scripts/lib/server.mjs");
  const server = await startServer();
  const { browser } = await launchBrowser({ proxyPort: server.port });
  try {
    const page = await browser.newPage();
    await page.goto(server.origin + "/harness.html");
    const xml = `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="&lt;img src=x onerror=&quot;window.__ran=1&quot;&gt;&lt;script&gt;window.__ran=2&lt;/script&gt;&lt;svg onload=&quot;window.__ran=3&quot;&gt;&lt;/svg&gt;" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
    await page.evaluate(t => window.drawioArch.load(t), server.addDiagram(Buffer.from(xml)));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__ran ?? null), null);
  } finally { await browser.close(); await server.close(); }
}, { browser: true });

// ---- slow, opt-in ----------------------------------------------------------------------------------
test("all icons: every catalogue entry and every kind renders without an error", async () => {
  const c = catalog(), k = kinds();
  const images = [...new Set(Object.values(c.icons).map(e => (/(?:^|;)image=([^;]+)/.exec(e.s) || [])[1]).filter(Boolean))];
  const pre = await prefetch(images);
  assert.deepEqual(pre.failed, [], "icon images could not be downloaded");
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cells = Object.entries(c.icons).map(([key, e], i) => {
    const scale = 48 / Math.max(e.w, e.h);
    return `<mxCell id="i${i}" value="${esc(key)}" style="${esc(e.s)}" vertex="1" parent="1"><mxGeometry x="${(i % 40) * 190}" y="${Math.floor(i / 40) * 130}" width="${Math.round(e.w * scale)}" height="${Math.round(e.h * scale)}" as="geometry"/></mxCell>`;
  });
  const grid = join(tmp, "all-icons.drawio");
  writeFileSync(grid, `<mxfile><diagram id="p" name="All icons"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`);
  const r1 = await checkFile(grid);
  assert.equal(r1.incomplete, null);
  assert.deepEqual(r1.pages[0].findings.filter(f => f.severity === "error").map(f => f.message), []);
  assert.equal(r1.pages[0].shapes, cells.length);
  // every group kind around every box kind, through the real build step
  const spec = { description: "Every box kind and every boundary kind, to test that each one renders.", nodes: [], groups: [], edges: [] };
  Object.keys(k.groups).forEach((g, i) => { spec.groups.push({ id: "g" + i, label: g, kind: g }); spec.nodes.push({ id: "gn" + i, label: "member", parent: "g" + i }); });
  Object.keys(k.nodes).forEach((n, i) => spec.nodes.push({ id: "n" + i, label: n, kind: n, tech: "tech", desc: "A short description of this element." }));
  for (const color of Object.keys(k.palette)) spec.nodes.push({ id: "c_" + color, label: color, color });
  const file = join(tmp, "all-kinds.drawio");
  writeFileSync(file, (await buildDiagram(spec)).xml);
  const r2 = await checkFile(file, { png: join(tmp, "all-kinds.png") });
  assert.deepEqual(serious(r2).map(f => f.kind + ": " + f.message), []);
}, { browser: true, elk: true, flag: "--all-icons" });

test("network: a download is verified, and a tampered cache file is replaced", async () => {
  const cache = join(tmp, "cache");
  const script = `import { getAsset } from ${JSON.stringify(join(ROOT, "scripts/lib/assets.mjs"))}; const b = await getAsset("stencils/kubernetes2.xml"); process.stdout.write(String(b.length) + " " + b.toString().includes("TAMPERED"));`;
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, DRAWIO_ARCH_CACHE: cache } });
  const size = manifest().files["stencils/kubernetes2.xml"][1];
  assert.equal(run().stdout, `${size} false`);
  const file = join(cache, "drawio", manifest().commit, "stencils", "kubernetes2.xml");
  appendFileSync(file, "<!-- TAMPERED -->");
  assert.equal(run().stdout, `${size} false`, "a tampered file must never be served");
  assert.equal(statSync(file).size, size);
}, { flag: "--network" });

// ---- run ------------------------------------------------------------------------------------------------
let passed = 0, failed = 0, skipped = 0;
for (const t of tests) {
  const why = t.flag && !flags.has(t.flag) ? `needs ${t.flag}` : t.browser && !haveBrowser ? "no browser (run setup)" : t.elk && !haveElk ? "layout library missing (run setup)" : null;
  if (why) { skipped++; console.log(`skip  ${t.name}  (${why})`); continue; }
  const t0 = Date.now();
  try { await t.fn(); passed++; console.log(`pass  ${t.name}  (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`FAIL  ${t.name}\n      ${String(e.message).split("\n").slice(0, 6).join("\n      ")}`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped` + (findPlaywright().length ? "" : " (Playwright not found)"));
process.exitCode = failed ? 1 : 0;

#!/usr/bin/env node
// Command-line entry point for the drawio-architecture skill.
//   node drawio-arch.mjs <command> [options]      (run with --help for the list)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HELP = `drawio-arch <command>

  setup [--install-browser] [--prefetch icons|all] [--check-only]
        One-time setup: pinned npm packages, verified draw.io files, browser check.
  scan [folder...] [--json]
        List the draw.io files that already exist under a folder (default: here) and what each page
        shows. Run this before drawing anything, to update a diagram instead of duplicating it.
  icons <words...> [--provider aws|azure|gcp|k8s|cisco|net] [--limit N] [--style] [--json]
        Search the icon catalogue. Prints keys to use in a spec; --style adds the draw.io style string.
  kinds Print the box kinds, group kinds and colours a spec can use.
  build <spec.json|-> -o <out.drawio> [--check] [--png <file.png>] [--scale N] [--theme light|dark] [--ignore kind,kind] [--overwrite]
        Lay out a spec and write a .drawio file. --check renders and inspects it straight away.
        Refuses to replace a diagram that was drawn or changed by hand unless --overwrite is given.
  describe <file.drawio> [--page N] [--set "text" | --set - ] [-o <out.drawio>]
        Show what each page says it shows, and where it came from. --set stores a description in the
        page (not drawn; visible in draw.io under Edit Data). --set - reads the text from standard input.
  spec <file.drawio> -o <out.json> [--page N] [--force]
        Write out the spec a page was built from, to change it and rebuild. Refused when the drawing
        was changed by hand since, because a rebuild would discard those changes (--force to get it anyway).
  check <file.drawio> [--png <file.png>] [--scale N] [--theme light|dark] [--json] [--ignore kind,kind] [--no-render] [--offline]
        Render with the draw.io viewer, report defects, optionally write a PNG.
        --theme dark draws the file as draw.io's dark theme shows it.
  backdrop <file.drawio> -o <out.drawio> [--margin N] [--fit] [--check] [--png <file.png>]
        Give each page of an existing file a locked white background box sized to its content, and
        turn off draw.io's dark-theme recolouring for it. Run again after editing to resize the box
        (--fit also shrinks it). -o may name the input file.
  outline <file.drawio>
        Compact text description of an existing file (for editing it).
  decompress <file.drawio> -o <out.drawio>
        Rewrite a compressed file as plain XML.
  serve <file.drawio>
        Keep the check page open at a local URL for manual viewing.

Exit codes: 0 = done and clean, 1 = findings to fix (or a spec problem), 2 = could not run.`;

function parse(argv) {
  const pos = [], opt = {};
  const VALUE = new Set(["o", "out", "png", "scale", "ignore", "provider", "limit", "prefetch", "margin", "theme", "page", "set"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-" || !a.startsWith("-")) { pos.push(a); continue; }
    const key = a.replace(/^--?/, "");
    if (VALUE.has(key)) { if (i + 1 >= argv.length) usage(`option ${a} needs a value`); opt[key === "out" ? "o" : key] = argv[++i]; }
    else opt[key] = true;
  }
  return { pos, opt };
}
function usage(msg) { console.error(msg + "\n\n" + HELP); process.exit(2); }
const list = v => (typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : []);
const scaleOf = opt => { const s = opt.scale == null ? 1 : Number(opt.scale); if (!(s >= 1 && s <= 3)) usage("--scale must be from 1 to 3"); return s; };
function need(path, what) { if (!path) usage(`missing ${what}`); if (!existsSync(path)) { console.error(`${what} not found: ${path}`); process.exit(2); } return path; }

async function runCheck(file, opt) {
  const { checkFile, formatReport } = await import("./lib/check.mjs");
  const theme = opt.theme ?? "light";
  if (!["light", "dark"].includes(theme)) usage("--theme takes light or dark");
  const report = await checkFile(file, { png: opt.png ?? null, scale: scaleOf(opt), offline: !!opt.offline, ignore: list(opt.ignore), render: !opt["no-render"], theme });
  console.log(opt.json ? JSON.stringify(report, null, 1) : formatReport(report));
  if (report.incomplete && !opt["no-render"]) return 2;
  return report.counts.error + report.counts.warning > 0 ? 1 : 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  if (!command || command === "help" || command === "--help" || command === "-h" || opt.help) { console.log(HELP); return 0; }

  if (command === "setup" || command === "doctor") {
    const { setup } = await import("./lib/setup.mjs");
    if (opt.prefetch != null && !["icons", "all"].includes(opt.prefetch)) usage("--prefetch takes icons or all");
    const r = await setup({ installBrowser: !!opt["install-browser"], prefetchSet: opt.prefetch ?? null, checkOnly: command === "doctor" || !!opt["check-only"] });
    return r.ready ? 0 : 2;
  }

  if (command === "scan") {
    const { scan, formatScan } = await import("./lib/scan.mjs");
    const where = pos.length ? pos : ["."];
    for (const p of where) need(p, "folder");
    const result = scan(where);
    console.log(opt.json ? JSON.stringify(result, null, 1) : formatScan(result));
    return 0;
  }

  if (command === "describe" || command === "spec") {
    const file = need(pos[0], "file");
    const { readDrawio } = await import("./lib/xml.mjs");
    const { readMeta, setDescription, sourceLine, descriptionProblems } = await import("./lib/meta.mjs");
    let doc;
    try { doc = readDrawio(readFileSync(file, "utf8")); } catch (e) { if (e.code !== "XML") throw e; console.error("not a readable draw.io file: " + e.message); return 1; }
    const wanted = opt.page == null ? null : Number(opt.page);
    if (wanted != null && !(Number.isInteger(wanted) && wanted >= 1 && wanted <= doc.pages.length)) usage(`--page must be from 1 to ${doc.pages.length}`);
    const title = p => `page ${p.index + 1}${p.name ? ` "${p.name}"` : ""}`;
    const one = what => {                                     // commands that act on one page need to know which
      if (wanted != null) return doc.pages[wanted - 1];
      if (doc.pages.length === 1) return doc.pages[0];
      console.error(`${file} has ${doc.pages.length} pages; say which one to ${what} with --page N:\n` + doc.pages.map(p => "  " + title(p)).join("\n"));
      return null;
    };

    if (command === "spec") {
      if (!opt.o) usage("spec needs -o <out.json>");
      const page = one("take the spec from"); if (!page) return 2;
      const meta = page.model ? readMeta(page.model) : { spec: null };
      if (!meta.spec) { console.error(`${title(page)} was not built by this skill, so it has no spec. Change it by editing its XML.`); return 1; }
      if (meta.edited && !opt.force) {
        console.error(`${title(page)} was changed by hand after it was built, so its spec no longer matches the drawing and a rebuild would discard those changes.\n` +
          "Change it by editing its XML. To get the spec anyway, add --force.");
        return 1;
      }
      writeFileSync(resolve(opt.o), JSON.stringify(meta.spec, null, 2) + "\n");
      console.log(`wrote ${opt.o}: the spec of ${title(page)}` + (meta.edited ? " (the drawing was changed by hand since; this spec does not include those changes)" : "") +
        `\nChange it, then rebuild over the diagram: build ${opt.o} -o ${pos[0]} --check --png <file.png>`);
      return 0;
    }

    if (opt.set == null) {
      for (const page of wanted != null ? [doc.pages[wanted - 1]] : doc.pages) {
        const meta = page.model ? readMeta(page.model) : { description: null, built: false };
        console.log(`${title(page)}\n  description: ${meta.description ?? "(none)"}\n  source: ${sourceLine(meta)}`);
      }
      return 0;
    }
    if (!opt.o) usage("describe --set needs -o <out.drawio> (it may be the same file)");
    const text = opt.set === "-" ? readFileSync(0, "utf8") : String(opt.set);
    const problems = descriptionProblems(text);
    if (problems.length) { console.error(problems.join("\n")); return 1; }
    const page = one("describe"); if (!page) return 2;
    if (!page.model || !setDescription(page.model, text)) { console.error(`${title(page)} has no root cell, so it cannot hold a description`); return 1; }
    const { serializePages } = await import("./lib/write.mjs");
    const out = resolve(opt.o);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, serializePages(doc.pages));
    console.log(`${title(page)}: ` + (text.trim() ? `description set (${text.trim().length} characters)` : "description removed") + `\nwrote ${opt.o}`);
    return 0;
  }

  if (command === "icons") {
    const { searchIcons, providers, resolveIcon } = await import("./lib/catalog.mjs");
    if (!pos.length) { console.log("Icons per provider: " + Object.entries(providers()).map(([p, n]) => `${p} ${n}`).join(", ") + "\nSearch with: icons <words> [--provider NAME]"); return 0; }
    const hits = searchIcons(pos.join(" "), { provider: opt.provider, limit: opt.limit ? Number(opt.limit) : 15 });
    if (opt.json) { console.log(JSON.stringify(hits.map(({ score, ...h }) => h))); return 0; }
    if (!hits.length) { console.log(`no icon matches "${pos.join(" ")}". Try fewer or different words, or a box kind (run: kinds).`); return 1; }
    for (const h of hits) {
      console.log(h.key.padEnd(44) + " " + h.title + (h.aliases.length ? `   (also: ${h.aliases.join(", ")})` : ""));
      if (opt.style) console.log(`    ${h.w}x${h.h}  ${resolveIcon(h.key).style.replace(/points=\[[^;]*\];/, "")}`);      // for editing XML by hand (optional connection points left out)
    }
    return 0;
  }

  if (command === "kinds") {
    const { kinds } = await import("./lib/catalog.mjs");
    const k = kinds();
    console.log("Box kinds (nodes without an icon):");
    for (const [name, d] of Object.entries(k.nodes)) console.log("  " + name.padEnd(16) + d.desc);
    console.log("\nGroup kinds (boundaries):");
    for (const [name, d] of Object.entries(k.groups)) console.log("  " + name.padEnd(30) + d.desc);
    console.log("\nColours: " + Object.keys(k.palette).join(", "));
    return 0;
  }

  if (command === "build") {
    if (!opt.o) usage("build needs -o <out.drawio>");
    const src = pos[0] === "-" ? readFileSync(0, "utf8") : readFileSync(need(pos[0], "spec file"), "utf8");
    let spec;
    try { spec = JSON.parse(src); } catch (e) { console.error("the spec is not valid JSON: " + e.message); return 1; }
    const { buildDiagram, SpecError } = await import("./lib/build.mjs");
    let result;
    try { result = await buildDiagram(spec); }
    catch (e) {
      if (e instanceof SpecError) { console.error("Spec problems:\n" + e.problems.map(p => "  - " + p).join("\n")); return 1; }
      if (e.code === "NO_ELK") { console.error(e.message); return 2; }
      throw e;
    }
    const out = resolve(opt.o);
    if (existsSync(out) && !opt.overwrite) {
      // A rebuild replaces the whole drawing. That is right for a diagram this skill built and nobody
      // has touched, and wrong for one that a person drew or rearranged.
      const { readDrawio } = await import("./lib/xml.mjs");
      const { readMeta } = await import("./lib/meta.mjs");
      let why = null;
      try {
        const pages = readDrawio(readFileSync(out, "utf8")).pages;
        const metas = pages.map(p => (p.model ? readMeta(p.model) : { built: false }));
        if (pages.length > 1) why = `has ${pages.length} pages, and a build writes one`;
        else if (!metas[0].built) why = "was drawn by hand, with another tool, or by an older version of this skill";
        else if (metas[0].edited !== false) why = "was changed by hand after it was built";
      } catch (e) { if (e.code !== "XML") throw e; why = "exists and is not a draw.io file this tool can read"; }
      if (why) {
        console.error(`${opt.o} ${why}. Building over it would replace the whole drawing.\n` +
          "To change it, edit its XML (SKILL.md, \"Editing an existing .drawio file\"). To replace it anyway, add --overwrite.");
        return 1;
      }
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.xml);
    const s = result.stats;
    console.log(`wrote ${opt.o}: ${s.nodes} nodes, ${s.groups} groups, ${s.edges} edges, about ${s.width}x${s.height} px`);
    for (const w of result.warnings) console.log("  note: " + w);
    if (opt.check || opt.png) return runCheck(out, opt);
    return 0;
  }

  if (command === "check") return runCheck(need(pos[0], "file"), opt);

  if (command === "backdrop") {
    if (!opt.o) usage("backdrop needs -o <out.drawio> (it may be the same file)");
    const margin = opt.margin == null ? undefined : Number(opt.margin);
    if (margin !== undefined && !(margin >= 0 && margin <= 500)) usage("--margin must be from 0 to 500");
    const { addBackdrop } = await import("./lib/backdrop.mjs");
    let result;
    try { result = await addBackdrop(need(pos[0], "file"), { margin, fit: !!opt.fit, offline: !!opt.offline }); }
    catch (e) { if (e.code !== "XML") throw e; console.error("not a readable draw.io file: " + e.message); return 1; }
    const out = resolve(opt.o);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.xml);
    const say = { added: "added a white background box", adopted: "moved the existing background box into a locked layer", resized: "updated the background box", unchanged: "background already in place" };
    for (const p of result.pages) console.log(`page ${p.index}${p.name ? ` "${p.name}"` : ""}: ` + (p.action === "skipped" ? `skipped (${p.why})` : `${say[p.action]} "${p.id}", ${p.rect.w}x${p.rect.h} px at ${p.rect.x},${p.rect.y}`));
    console.log(`wrote ${opt.o}`);
    if (opt.check || opt.png) return runCheck(out, opt);
    return result.pages.some(p => p.action !== "skipped") ? 0 : 1;
  }

  if (command === "outline") {
    const { outline } = await import("./lib/lint.mjs");
    try { console.log(outline(readFileSync(need(pos[0], "file"), "utf8"))); } catch (e) { if (e.code !== "XML") throw e; console.error("not a readable draw.io file: " + e.message); return 1; }
    return 0;
  }

  if (command === "decompress") {
    if (!opt.o) usage("decompress needs -o <out.drawio>");
    const { readDrawio } = await import("./lib/xml.mjs");
    const text = readFileSync(need(pos[0], "file"), "utf8");
    let doc;
    try { doc = readDrawio(text); } catch (e) { if (e.code !== "XML") throw e; console.error("not a readable draw.io file: " + e.message); return 1; }
    const { serializePages } = await import("./lib/write.mjs");
    writeFileSync(resolve(opt.o), serializePages(doc.pages));
    console.log(`wrote ${opt.o}: ${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"} as plain XML` + (doc.pages.some(p => p.compressed) ? "" : " (the input was not compressed)"));
    return 0;
  }

  if (command === "serve") {
    const { startServer } = await import("./lib/server.mjs");
    const server = await startServer();
    const token = server.addDiagram(readFileSync(need(pos[0], "file")));
    console.log(`${server.origin}/harness.html#${token}\nOpen this address in a browser on this computer. Press Ctrl+C to stop.`);
    await new Promise(r => { process.on("SIGINT", r); process.on("SIGTERM", r); });
    await server.close();
    return 0;
  }

  usage(`unknown command "${command}"`);
}

main().then(code => { process.exitCode = code ?? 0; }).catch(e => {
  if (e.code === "USAGE" || e.code === "SETUP" || e.code === "ENOENT") console.error(e.message);
  else console.error(e.stack || String(e));
  process.exitCode = 2;
});

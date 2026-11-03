// One-time setup: two pinned npm packages, the draw.io viewer and stencils, a browser check.
// Everything goes into the cache folder; the skill folder is never written to.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cacheRoot, drawioCacheDir, manifest, nodeCacheDir, SCRIPTS_DIR } from "./paths.mjs";
import { getAsset, prefetch } from "./assets.mjs";
import { catalog } from "./catalog.mjs";
import { launchBrowser } from "./browser.mjs";

const CORE = ["js/viewer-static.min.js", "stencils/aws4.xml", "stencils/gcp2.xml", "stencils/kubernetes.xml", "stencils/kubernetes2.xml", "stencils/cisco19.xml", "stencils/networks.xml"];

function pinned() { return JSON.parse(readFileSync(join(SCRIPTS_DIR, "package.json"), "utf8")).dependencies; }
function installed(name) {
  // Only what is really in the cache folder counts; a copy found elsewhere on the machine is not the pinned one.
  try { return JSON.parse(readFileSync(join(nodeCacheDir(), "node_modules", name, "package.json"), "utf8")).version; } catch { return null; }
}
export function packagesReady() { const want = pinned(); return Object.entries(want).every(([n, v]) => installed(n) === v); }

function run(cmd, args, cwd) {
  // No shell on POSIX. On Windows npm is a .cmd file, which needs one; the arguments are fixed strings.
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32", timeout: 15 * 60 * 1000 });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim(), error: r.error };
}

export async function setup({ installBrowser = false, prefetchSet = null, checkOnly = false, log = console.log } = {}) {
  const steps = [];
  const step = (name, ok, detail, fix) => { steps.push({ name, ok, detail, fix }); log(`${ok ? "ok    " : "FAILED"}  ${name}${detail ? ": " + detail : ""}`); if (!ok && fix) log("        -> " + fix); };
  const major = Number(process.versions.node.split(".")[0]);
  step("Node.js", major >= 18, `v${process.versions.node}`, "Node.js 18 or newer is required");
  log(`        cache folder: ${cacheRoot()}`);

  // 1. npm packages, pinned by scripts/package-lock.json, installed without running any install scripts
  const want = pinned();
  if (!packagesReady() && !checkOnly) {
    mkdirSync(nodeCacheDir(), { recursive: true });
    for (const f of ["package.json", "package-lock.json"]) copyFileSync(join(SCRIPTS_DIR, f), join(nodeCacheDir(), f));
    const r = run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], nodeCacheDir());
    if (!r.ok) log("        npm said: " + (r.error ? r.error.message : r.out.split("\n").slice(-3).join(" | ")).slice(0, 400));
  }
  step("npm packages", packagesReady(), Object.entries(want).map(([n, v]) => `${n} ${installed(n) ?? "missing"}${installed(n) === v ? "" : ` (want ${v})`}`).join(", "),
    "run the setup command (it needs npm and access to registry.npmjs.org)");

  // 2. draw.io files from the pinned commit, each verified by SHA-256
  let core = { ok: 0, failed: [] };
  if (checkOnly) { for (const rel of CORE) { try { await getAsset(rel, { offline: true }); core.ok++; } catch (e) { core.failed.push({ rel, error: "not downloaded yet" }); } } }
  else core = await prefetch(CORE);
  step(`draw.io ${manifest().version} viewer and stencils`, core.failed.length === 0, core.failed.length ? core.failed.map(f => `${f.rel}: ${f.error}`).slice(0, 2).join("; ") : `${core.ok} files verified in ${drawioCacheDir()}`,
    "run the setup command (it needs access to raw.githubusercontent.com; set HTTPS_PROXY if you are behind a proxy)");
  if (prefetchSet && !checkOnly) {
    const files = prefetchSet === "all" ? Object.keys(manifest().files)
      : [...new Set(Object.values(catalog().icons).map(e => (/(?:^|;)image=([^;]+)/.exec(e.s) || [])[1]).filter(Boolean))];
    let last = 0;
    const r = await prefetch(files, { onProgress: (done, total) => { if (done - last >= 200 || done === total) { last = done; log(`        ${done}/${total} files`); } } });
    step(prefetchSet === "all" ? "every draw.io stencil and image (offline use)" : "icon images for the catalogue (offline use)", r.failed.length === 0, `${r.ok} verified` + (r.failed.length ? `, ${r.failed.length} failed (${r.failed[0].error})` : ""), "run setup again to retry the failed files");
  }

  // 3. browser
  let browserOk = false, detail = "";
  const tryLaunch = async () => {
    try { const b = await launchBrowser(); detail = `${b.playwright}, Chromium ${b.browserVersion}${b.sandbox ? "" : ", sandbox off"}`; await b.browser.close(); return true; }
    catch (e) { detail = e.message + (e.attempts && e.attempts.length ? " [" + e.attempts.slice(0, 2).join(" | ") + "]" : ""); return false; }
  };
  browserOk = await tryLaunch();
  if (!browserOk && installBrowser && !checkOnly) {
    if (installed("playwright")) {
      log("        downloading Chromium with Playwright (about 150 MB, from Playwright's download servers) ...");
      const cli = createRequire(join(nodeCacheDir(), "package.json")).resolve("playwright/cli.js");
      const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 20 * 60 * 1000 });
      if (r.status !== 0) log("        playwright said: " + ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-3).join(" | ").slice(0, 400));
      browserOk = await tryLaunch();
    }
  }
  step("Chromium for rendering", browserOk, detail, "run setup again with --install-browser, or point DRAWIO_ARCH_PLAYWRIGHT at a folder whose node_modules has a working Playwright");

  // 4. end to end: build a two-node diagram and check it
  let smoke = false, smokeDetail = "skipped";
  if (steps.every(s => s.ok)) {
    const dir = join(tmpdir(), "drawio-arch-setup-" + process.pid);
    try {
      mkdirSync(dir, { recursive: true });
      const { buildDiagram } = await import("./build.mjs");
      const { checkFile } = await import("./check.mjs");
      const { xml } = await buildDiagram({ description: "Setup test: a client calls a function.", nodes: [{ id: "a", label: "Client", kind: "client" }, { id: "b", label: "Function", icon: "aws.lambda" }], edges: [{ from: "a", to: "b", label: "calls" }] });
      writeFileSync(join(dir, "smoke.drawio"), xml);
      const rep = await checkFile(join(dir, "smoke.drawio"), { png: join(dir, "smoke.png") });
      smoke = rep.rendered && !rep.incomplete && rep.counts.error + rep.counts.warning === 0 && existsSync(join(dir, "smoke.png"));
      smokeDetail = smoke ? "built, rendered and checked a test diagram" : (rep.incomplete || rep.pages.flatMap(p => p.findings).map(f => f.message)[0] || "unexpected result");
    } catch (e) { smokeDetail = e.message; }
    finally { rmSync(dir, { recursive: true, force: true }); }
    step("end-to-end test", smoke, smokeDetail);
  }
  const ready = steps.every(s => s.ok);
  log(ready ? "\nReady." : "\nNot ready: fix the FAILED steps above.");
  return { ready, steps };
}

// Finds a Playwright installation and starts a headless Chromium that can only
// talk to this machine.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { nodeCacheDir, SCRIPTS_DIR } from "./paths.mjs";

function candidates() {
  const bases = [];
  if (process.env.DRAWIO_ARCH_PLAYWRIGHT) bases.push(["DRAWIO_ARCH_PLAYWRIGHT", join(process.env.DRAWIO_ARCH_PLAYWRIGHT, "package.json")]);
  bases.push(["skill cache", join(nodeCacheDir(), "package.json")]);
  bases.push(["skill folder", join(SCRIPTS_DIR, "package.json")]);
  bases.push(["current folder", join(process.cwd(), "package.json")]);
  for (const p of (process.env.NODE_PATH || "").split(process.platform === "win32" ? ";" : ":").filter(Boolean)) bases.push(["NODE_PATH", join(p, "..", "package.json")]);
  const prefix = dirname(dirname(process.execPath));
  bases.push(["global", join(prefix, "lib", "package.json")]);
  bases.push(["global", join(prefix, "package.json")]);
  return bases;
}

/** All Playwright installs that can be loaded, best first. */
export function findPlaywright() {
  const found = [], seen = new Set();
  for (const [where, base] of candidates()) {
    for (const name of ["playwright", "playwright-core"]) {
      try {
        const req = createRequire(base);
        const main = req.resolve(name);
        if (seen.has(main)) continue;
        seen.add(main);
        let version = "?";
        try { version = req(name + "/package.json").version; } catch { /* older layouts */ }
        const real = main.startsWith(nodeCacheDir()) ? "installed by setup" : where === "skill cache" ? "found on this machine" : where;
        found.push({ where: real, name, version, load: () => req(name) });
      } catch { /* not here */ }
    }
  }
  return found;
}

/**
 * Starts Chromium. `proxyPort` is the local dead-end proxy: every request to a
 * host other than this machine goes there and is refused.
 */
export async function launchBrowser({ proxyPort } = {}) {
  const installs = findPlaywright();
  if (!installs.length) throw Object.assign(new Error("Playwright is not installed"), { code: "NO_BROWSER", attempts: [] });
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const wantSandbox = !isRoot && process.env.DRAWIO_ARCH_NO_SANDBOX !== "1";
  const attempts = [];
  for (const inst of installs) {
    let pw;
    try { pw = inst.load(); } catch (e) { attempts.push(`${inst.name} ${inst.version} (${inst.where}): cannot be loaded: ${e.message.split("\n")[0]}`); continue; }
    for (const sandbox of wantSandbox ? [true, false] : [false]) {
      const options = { headless: true, chromiumSandbox: sandbox, args: ["--disable-extensions", "--no-first-run", "--disable-sync", "--disable-background-networking", "--disable-component-update"] };
      if (proxyPort) options.proxy = { server: `http://127.0.0.1:${proxyPort}`, bypass: "127.0.0.1" };
      if (process.env.DRAWIO_ARCH_CHROMIUM) { if (!existsSync(process.env.DRAWIO_ARCH_CHROMIUM)) throw Object.assign(new Error("DRAWIO_ARCH_CHROMIUM points to a file that does not exist"), { code: "NO_BROWSER", attempts }); options.executablePath = process.env.DRAWIO_ARCH_CHROMIUM; }
      try {
        const browser = await pw.chromium.launch(options);
        return { browser, playwright: `${inst.name} ${inst.version} (${inst.where})`, sandbox, browserVersion: browser.version() };
      } catch (e) {
        attempts.push(`${inst.name} ${inst.version} (${inst.where})${sandbox ? "" : ", sandbox off"}: ${String(e.message).split("\n")[0].slice(0, 200)}`);
      }
    }
  }
  throw Object.assign(new Error("no usable Chromium was found for Playwright"), { code: "NO_BROWSER", attempts });
}

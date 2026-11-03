// Where things live. The skill folder is treated as read-only; everything the
// skill downloads or installs goes into a per-user cache folder.
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ASSETS_DIR = join(SKILL_DIR, "assets");
export const SCRIPTS_DIR = join(SKILL_DIR, "scripts");

export function cacheRoot() {
  if (process.env.DRAWIO_ARCH_CACHE) return resolve(process.env.DRAWIO_ARCH_CACHE);
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, "drawio-architecture");
  if (platform() === "darwin") return join(homedir(), "Library", "Caches", "drawio-architecture");
  if (platform() === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "drawio-architecture", "Cache");
  return join(homedir(), ".cache", "drawio-architecture");
}

let manifestCache;
export function manifest() {
  if (!manifestCache) manifestCache = JSON.parse(readFileSync(join(ASSETS_DIR, "drawio-manifest.json"), "utf8"));
  return manifestCache;
}

// draw.io files are cached per pinned commit, so changing the pin never mixes versions.
export const drawioCacheDir = () => join(cacheRoot(), "drawio", manifest().commit);
// npm packages (elkjs, playwright) are installed here by `setup`.
export const nodeCacheDir = () => join(cacheRoot(), "node");

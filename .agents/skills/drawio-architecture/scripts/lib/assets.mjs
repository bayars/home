// draw.io files (viewer script, stencils, icon images): fetched on demand from
// the pinned commit, verified against assets/drawio-manifest.json, then cached.
// A file that is not in the manifest, or whose SHA-256 does not match, is never used.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { drawioCacheDir, manifest } from "./paths.mjs";
import { ALLOWED_HOST, fetchPinned } from "./net.mjs";

const verified = new Map();        // rel path -> Buffer (already checked in this process)
const inflight = new Map();

export const sha256 = buf => createHash("sha256").update(buf).digest("base64");
// A path is usable only if it is on the manifest and is a plain relative path (no "..", no empty parts).
export const isListed = rel => typeof rel === "string" && Object.prototype.hasOwnProperty.call(manifest().files, rel) && rel.split("/").every(p => p && p !== ".." && p !== ".") && !rel.includes("\\");
export const pinnedUrl = rel => `https://${ALLOWED_HOST}/jgraph/drawio/${manifest().commit}/${manifest().base}/${rel.split("/").map(encodeURIComponent).join("/")}`;

function matches(buf, rel) {
  const [hash, size] = manifest().files[rel];
  return buf.length === size && sha256(buf) === hash;
}

/**
 * Returns the verified bytes of a draw.io file, or null when the path is not
 * in the allowlist. Throws when the file cannot be obtained or fails its check.
 */
export async function getAsset(rel, { offline = false } = {}) {
  if (!isListed(rel)) return null;
  if (verified.has(rel)) return verified.get(rel);
  if (inflight.has(rel)) return inflight.get(rel);
  const job = (async () => {
    const file = join(drawioCacheDir(), ...rel.split("/"));
    let buf = null;
    try { buf = readFileSync(file); } catch { /* not cached yet */ }
    if (buf && !matches(buf, rel)) { buf = null; rmSync(file, { force: true }); }   // damaged or altered: discard
    if (!buf) {
      if (offline) throw Object.assign(new Error(`${rel} is not in the cache and --offline was given`), { code: "OFFLINE" });
      const got = await fetchPinned(pinnedUrl(rel));
      if (!matches(got, rel)) throw Object.assign(new Error(`checksum mismatch for ${rel}: the download does not match the pinned draw.io release, so it was discarded`), { code: "INTEGRITY" });
      mkdirSync(dirname(file), { recursive: true });
      const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
      writeFileSync(tmp, got);
      renameSync(tmp, file);
      buf = got;
    }
    verified.set(rel, buf);
    return buf;
  })();
  inflight.set(rel, job);
  try { return await job; } finally { inflight.delete(rel); }
}

/** Download a list of files with limited concurrency. Returns {ok, failed:[{rel,error}]}. */
export async function prefetch(rels, { concurrency = 6, onProgress } = {}) {
  const queue = rels.filter(isListed);
  const failed = []; let ok = 0, i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const rel = queue[i++];
      try { await getAsset(rel); ok++; } catch (e) { failed.push({ rel, error: e.message }); }
      verified.delete(rel);                           // keep memory flat during bulk downloads
      if (onProgress) onProgress(ok + failed.length, queue.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { ok, failed };
}

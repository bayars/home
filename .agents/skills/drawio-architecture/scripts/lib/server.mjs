// A short-lived web server on 127.0.0.1 that feeds the check page.
//
// It serves three things only: the check page itself, the diagram being checked
// (under an unguessable path), and draw.io files from the verified allowlist.
// It also acts as a dead-end proxy for the browser, so anything the browser
// tries to load from another host ends here with a 403 and is recorded.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR } from "./paths.mjs";
import { getAsset, isListed } from "./assets.mjs";

const TYPES = { js: "text/javascript; charset=utf-8", xml: "text/xml; charset=utf-8", svg: "image/svg+xml", png: "image/png", gif: "image/gif",
  css: "text/css; charset=utf-8", ttf: "font/ttf", html: "text/html; charset=utf-8", jpg: "image/jpeg" };
const CSP = "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";

export async function startServer({ offline = false } = {}) {
  const diagrams = new Map();              // token -> Buffer
  const log = { missing: [], failed: [], external: [] };
  const page = readFileSync(join(ASSETS_DIR, "viewer", "harness.html"));
  const inspect = readFileSync(join(ASSETS_DIR, "viewer", "inspect.js"));
  let port = 0;

  const send = (res, status, body, type) => {
    res.writeHead(status, { "content-type": type ?? "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": CSP, "referrer-policy": "no-referrer" });
    res.end(body);
  };
  const server = http.createServer(async (req, res) => {
    try {
      // Absolute-form requests arrive when the browser uses this server as its proxy: refuse and record.
      // Playwright sends even local requests through the proxy, so a proxy-style request for this server is served normally.
      let target = req.url;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
        let u = null;
        try { u = new URL(target); } catch { /* handled below */ }
        if (!u || u.protocol !== "http:" || u.host !== `127.0.0.1:${port}`) { log.external.push(target.slice(0, 300)); send(res, 403, "blocked: outside network access is disabled during a check"); return; }
        target = u.pathname + u.search;
      }
      const host = String(req.headers.host || "");
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { send(res, 403, "forbidden"); return; }
      if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, "method not allowed"); return; }
      let path;
      try { path = decodeURIComponent(new URL(target, "http://127.0.0.1").pathname); } catch { send(res, 400, "bad request"); return; }
      if (path === "/harness.html") { send(res, 200, page, TYPES.html); return; }
      if (path === "/inspect.js") { send(res, 200, inspect, TYPES.js); return; }
      if (path === "/favicon.ico") { send(res, 204, ""); return; }
      if (path.startsWith("/d/")) {
        const buf = diagrams.get(path.slice(3));
        if (buf) send(res, 200, buf, TYPES.xml); else send(res, 404, "not found");
        return;
      }
      const rel = path.replace(/^\/+/, "");
      if (!rel || rel.includes("..") || rel.includes("\\") || rel.includes("\0") || !isListed(rel)) { log.missing.push(rel.slice(0, 300)); send(res, 404, "not found"); return; }
      let buf;
      try { buf = await getAsset(rel, { offline }); }
      catch (e) { log.failed.push({ rel, error: e.message, code: e.code }); send(res, 502, "could not obtain " + rel); return; }
      send(res, 200, buf, TYPES[rel.split(".").pop().toLowerCase()] ?? "application/octet-stream");
    } catch (e) {
      try { send(res, 500, "error"); } catch { /* socket already closed */ }
    }
  });
  server.on("connect", (req, socket) => {     // HTTPS through the dead-end proxy
    log.external.push("https://" + String(req.url).slice(0, 300));
    socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
  });
  server.on("clientError", (err, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  port = server.address().port;
  return {
    port, origin: `http://127.0.0.1:${port}`, log,
    addDiagram(buffer) { const token = randomBytes(16).toString("hex"); diagrams.set(token, buffer); return token; },
    close() { return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); }); },
  };
}

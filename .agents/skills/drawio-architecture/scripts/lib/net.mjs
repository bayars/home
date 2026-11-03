// The only code in this skill that talks to the internet.
//
// It can fetch exactly one kind of URL: a file from the pinned commit of the
// official draw.io repository on raw.githubusercontent.com. TLS verification is
// always on, redirects are refused, and the caller checks the SHA-256 of what
// comes back (see assets.mjs).
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

export const ALLOWED_HOST = "raw.githubusercontent.com";
const MAX_BYTES = 32 * 1024 * 1024;

function proxyFor(hostname) {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return null;
  const no = (process.env.NO_PROXY || process.env.no_proxy || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const h = hostname.toLowerCase();
  if (no.some(n => n === "*" || h === n.replace(/^\*?\./, "") || h.endsWith("." + n.replace(/^\*?\./, "")))) return null;
  let u;
  try { u = new URL(raw); } catch { throw new Error("HTTPS_PROXY is not a valid URL"); }
  if (u.protocol !== "http:") throw new Error("only http:// proxies are supported (HTTPS_PROXY=" + u.protocol + "//…)");
  return u;
}

function tunnel(proxy, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = { host: `${host}:${port}` };
    if (proxy.username) headers["proxy-authorization"] = "Basic " + Buffer.from(decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password)).toString("base64");
    const req = http.request({ host: proxy.hostname, port: proxy.port || 80, method: "CONNECT", path: `${host}:${port}`, headers, timeout: timeoutMs });
    req.once("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`proxy refused the connection to ${host} (HTTP ${res.statusCode})`)); return; }
      resolve(socket);
    });
    req.once("timeout", () => req.destroy(new Error("proxy connection timed out")));
    req.once("error", reject);
    req.end();
  });
}

async function once(u, timeoutMs) {
  const proxy = proxyFor(u.hostname);
  const options = { host: u.hostname, port: 443, path: u.pathname, method: "GET", servername: u.hostname, timeout: timeoutMs, agent: false,
    headers: { "user-agent": "drawio-architecture-skill", accept: "*/*", "accept-encoding": "identity", connection: "close" } };
  let socket = null;
  if (proxy) {
    socket = await tunnel(proxy, u.hostname, 443, timeoutMs);
    socket.on("error", () => {});                 // a late reset on the idle tunnel must not crash the process
    options.createConnection = () => tls.connect({ socket, servername: u.hostname });
  }
  try {
    return await new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        if (res.statusCode !== 200) { res.resume(); reject(Object.assign(new Error(`HTTP ${res.statusCode} for ${u.pathname}`), { status: res.statusCode })); return; }
        const chunks = []; let n = 0;
        res.on("data", c => { n += c.length; if (n > MAX_BYTES) { req.destroy(new Error("response too large")); return; } chunks.push(c); });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });
      req.once("timeout", () => req.destroy(new Error("download timed out: " + u.pathname)));
      req.once("error", reject);
      req.end();
    });
  } finally {
    if (socket) socket.destroy();
  }
}

/** GET a pinned draw.io file. Returns a Buffer, or throws. Retries brief network failures. */
export async function fetchPinned(url, { timeoutMs = 60000, attempts = 3 } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST || u.port) throw new Error("refusing to fetch " + u.origin + ": only https://" + ALLOWED_HOST + " is allowed");
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await once(u, timeoutMs); }
    catch (e) {
      last = e;
      if (e.status && e.status < 500 && e.status !== 429) break;       // 404 and the like will not get better
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

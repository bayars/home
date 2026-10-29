#!/usr/bin/env node
/**
 * capture.mjs — screenshot a running React UI with Playwright and run the
 * automated half of a design review:
 *
 *   - screenshots per page x state x viewport x theme (fold + full-page tiles)
 *   - axe-core accessibility audit (WCAG 2.x A/AA + best practices)
 *   - layout checks (horizontal scroll, clipped text, tap targets, tiny text...)
 *   - keyboard walk (focus order overlay, missing/weak focus indicators, traps)
 *   - design-token compliance (colors, fonts, sizes, spacing, radii actually rendered)
 *   - runtime health (console errors, failed requests, error overlays)
 *
 * Output: <out>/<label>/report.json, SUMMARY.md and shots/*.png
 * Usage:  node capture.mjs --url http://localhost:5173/dashboard
 *         node capture.mjs --config design-review.config.json
 *         node capture.mjs --help
 */
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..');

const HELP = `
ui-design-review capture

  --url <url>            Page to review (repeatable). Or use --config.
  --name <name>          Name for the page given by --url (default: derived from the path)
  --config <file>        JSON config with pages/states/viewports (see design-review.config.example.json)
  --out <dir>            Output root (default: .design-review)
  --label <name>         Sub-folder for this run (default: latest). Use e.g. before / after.
  --viewports <list>     mobile,tablet,desktop,wide,reflow, "all", or WxH (default: mobile,tablet,desktop)
  --themes <list>        light,dark (default: light)
  --wait-for <selector>  Wait for this selector before capturing
  --settle <ms>          Extra wait after load (default: 400)
  --storage-state <file> Playwright storageState JSON for authenticated pages
  --tokens <file>        Design tokens JSON (default: <skill>/design-system/tokens.json)
  --max-tabs <n>         Max Tab presses in the keyboard walk (default: 40)
  --no-axe / --no-focus / --no-tokens / --no-layout / --no-ux / --no-feedback / --no-text-checks   Skip a check
  --server-timeout <ms>  How long to wait for the dev server to answer (default: 60000)
  --fail-on <severity>   Exit code 2 if findings at or above: critical | major | minor
  --channel <name>       Use an installed browser instead of Playwright's download: chrome | msedge
  --browser-path <exe>   Explicit browser executable (or env DESIGN_REVIEW_BROWSER)
  --headed               Show the browser
`;

/* ----------------------------------------------------------------- args */

function parseArgs(argv) {
  const a = { url: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { a.flags.add(key); continue; }
    i++;
    if (key === 'url') a.url.push(next); else a[key] = next;
  }
  return a;
}

const VIEWPORTS = {
  mobile: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  wide: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  // WCAG 1.4.10 Reflow: content must work at 320 CSS px without two-dimensional scrolling.
  reflow: { width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

function resolveViewports(spec) {
  if (Array.isArray(spec)) spec = spec.map((v) => (typeof v === 'string' ? v : v)).filter(Boolean);
  else spec = String(spec || 'mobile,tablet,desktop').split(',').map((s) => s.trim()).filter(Boolean);
  if (spec.includes('all')) spec = Object.keys(VIEWPORTS);
  return spec.map((v) => {
    if (typeof v === 'object') return { name: v.name || `${v.width}x${v.height}`, deviceScaleFactor: 1, isMobile: false, hasTouch: false, ...v };
    if (VIEWPORTS[v]) return { name: v, ...VIEWPORTS[v] };
    const m = /^(\d+)x(\d+)$/.exec(v);
    if (m) return { name: v, width: +m[1], height: +m[2], deviceScaleFactor: 1, isMobile: false, hasTouch: false };
    throw new Error(`Unknown viewport "${v}". Use ${Object.keys(VIEWPORTS).join(', ')} or WxH.`);
  });
}

function loadDep(names) {
  const roots = [path.join(HERE, 'x.js'), path.join(process.cwd(), 'x.js')];
  for (const root of roots) {
    const req = createRequire(root);
    for (const n of names) {
      try { return { mod: req(n), file: req.resolve(n), name: n }; } catch { /* try next */ }
    }
  }
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
const SEV_ORDER = ['critical', 'major', 'minor', 'info'];

/* ------------------------------------------------- in-page helper code */

/* Installed on window.__dr after every navigation. Must be self-contained. */
function installHelpers() {
  const part = (e) => {
    const s = e.tagName.toLowerCase();
    if (e.id && !/\d{3,}|^:r|^radix-|^headlessui-|^mui-/.test(e.id)) return s + '#' + CSS.escape(e.id);
    const tid = e.getAttribute('data-testid') || e.getAttribute('data-test');
    if (tid) return `${s}[data-testid="${tid}"]`;
    const cls = [...e.classList].filter((c) => c.length < 32 && !c.startsWith('data-dr')).slice(0, 2);
    return cls.length ? s + '.' + cls.map((c) => CSS.escape(c)).join('.') : s;
  };
  const selectorOf = (el) => {
    const parts = [];
    let e = el;
    while (e && e.nodeType === 1 && parts.length < 3 && e !== document.documentElement) {
      const p = part(e);
      parts.unshift(p);
      if (p.includes('#')) break;
      e = e.parentElement;
    }
    return parts.join(' > ');
  };
  /* Map a DOM node back to the React components that rendered it, so findings
     can be traced to source files instead of anonymous <div>s. */
  const componentOf = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
    if (!k) return null;
    let f = el[k];
    const names = [];
    const ds = f && f._debugSource;
    let source = ds ? `${ds.fileName}:${ds.lineNumber}` : null;
    let guard = 0;
    while (f && names.length < 3 && guard++ < 60) {
      const t = f.type;
      let n = null;
      if (typeof t === 'function') n = t.displayName || t.name;
      else if (t && typeof t === 'object') n = t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name));
      if (n && n.length > 2 && names[names.length - 1] !== n) {
        names.push(n);
        if (!source && f._debugSource) source = `${f._debugSource.fileName}:${f._debugSource.lineNumber}`;
      }
      f = f.return;
    }
    return names.length ? { chain: names.join(' < '), source } : null;
  };
  const textOf = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.value || '')
    .toString().replace(/\s+/g, ' ').trim().slice(0, 60);
  const desc = (el) => {
    const r = el.getBoundingClientRect();
    const c = componentOf(el);
    return {
      selector: selectorOf(el),
      text: textOf(el),
      component: c ? c.chain : undefined,
      file: c && c.source ? c.source : undefined,
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  /* Text that is cut off or spilling — reused to see what breaks under larger text / wider spacing. */
  const clipped = () => {
    const list = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (list.length > 60) break;
      if (!el.firstChild || el.closest('svg,[data-dr-overlay],script,style')) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || cs.visibility === 'hidden' || cs.display === 'inline') continue;
      let kind = null;
      if (!own) {
        if (['hidden', 'clip'].includes(cs.overflowY) && el.clientHeight > 20 && el.scrollHeight > el.clientHeight + 8 && (el.innerText || '').trim() && (!cs.webkitLineClamp || cs.webkitLineClamp === 'none')) list.push({ kind: 'container cuts off part of its content', key: selectorOf(el) + '|box', ...desc(el) });
        continue;
      }
      if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis') kind = 'is cut off';
      else if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'visible' && !['TD', 'TH'].includes(el.tagName)) kind = 'spills out of its container';
      else if (['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 3 && (!cs.webkitLineClamp || cs.webkitLineClamp === 'none')) kind = 'is cut off vertically';
      if (kind) list.push({ kind, key: selectorOf(el) + '|' + textOf(el).slice(0, 30), ...desc(el) });
    }
    return { list, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  };
  const textEls = () => [...document.body.querySelectorAll('*')].filter((el) => {
    if (el.closest('svg,[data-dr-overlay],script,style,noscript')) return false;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }).slice(0, 2000);
  window.__dr = { desc, selectorOf, componentOf, textOf, clipped, textEls };
}

/* Layout checks + inventory of the styles that are actually rendered. */
function inPageAudit(opts) {
  const { touch, minTouchTarget, minFontSize, ignoreSelectors, tokenColors, maxElements } = opts;
  const { desc } = window.__dr;
  const vw = document.documentElement.clientWidth;
  const findings = [];
  const perRule = {};
  const add = (rule, severity, message, el, extra) => {
    perRule[rule] = (perRule[rule] || 0) + 1;
    if (perRule[rule] > 12) return; // keep the report readable; the count is still reported
    findings.push({ rule, severity, message, ...(el ? desc(el) : {}), ...(extra || {}) });
  };
  const ignored = (el) => ignoreSelectors.some((s) => { try { return !!el.closest(s); } catch { return false; } });

  /* Normalise any CSS colour (hex, rgb, hsl, oklch, color-mix...) to RGBA bytes via canvas. */
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  const norm = (c) => {
    if (colorCache.has(c)) return colorCache.get(c);
    ctx.fillStyle = '#010203';
    ctx.fillStyle = c;
    let v = null;
    if (!(ctx.fillStyle === '#010203' && !/^#?010203$|rgb\(1, ?2, ?3\)/i.test(c))) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      v = [d[0], d[1], d[2], d[3]];
    }
    colorCache.set(c, v);
    return v;
  };
  const hex = (v) => '#' + v.slice(0, v[3] === 255 ? 3 : 4).map((n) => n.toString(16).padStart(2, '0')).join('');
  const tokens = (tokenColors || []).map((t) => ({ name: t.name, rgba: norm(t.value) })).filter((t) => t.rgba);
  const matchToken = (v) => {
    const tol = v[3] === 255 ? 1 : 4; // canvas un-premultiplies translucent colours with rounding error
    let best = null;
    let bestD = Infinity;
    for (const t of tokens) {
      const d = [0, 1, 2, 3].map((i) => Math.abs(t.rgba[i] - v[i]));
      if (d.every((x) => x <= tol)) return { match: t.name };
      const dist = Math.hypot(d[0], d[1], d[2]) + d[3];
      if (dist < bestD) { bestD = dist; best = t; }
    }
    return { match: null, nearest: best ? `${best.name} (${hex(best.rgba)})` : null };
  };

  const inv = { textColor: {}, backgroundColor: {}, borderColor: {}, fontFamily: {}, fontSize: {}, fontWeight: {}, spacing: {}, radius: {} };
  const note = (cat, key, el) => {
    const e = (inv[cat][key] ||= { count: 0, samples: [] });
    e.count++;
    if (e.samples.length < 3) e.samples.push(desc(el));
  };
  const noteColor = (cat, css, el) => {
    const v = norm(css);
    if (!v || v[3] === 0) return;
    const key = hex(v);
    note(cat, key, el);
    if (tokens.length && inv[cat][key].token === undefined) Object.assign(inv[cat][key], { token: null }, (() => { const m = matchToken(v); return { token: m.match, nearest: m.nearest }; })());
  };
  const px = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

  const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[role=combobox],[tabindex]:not([tabindex^="-"])';
  const all = [...document.body.querySelectorAll('*')].slice(0, maxElements);
  const pageOverflows = document.documentElement.scrollWidth > vw + 1;
  const overflowers = [];
  let maxBottom = 0;

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'br'].includes(tag)) continue;
    if (el.closest('[data-dr-overlay]') || ignored(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.01;
    if (!visible) continue;
    if (cs.position !== 'fixed') maxBottom = Math.max(maxBottom, r.bottom + scrollY);
    const inSvg = !!el.closest('svg') && tag !== 'svg';
    const ownText = !inSvg && [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 0);
    const fontSize = px(cs.fontSize);

    /* ---- inventory ---- */
    if (!inSvg) {
      if (ownText) {
        noteColor('textColor', cs.color, el);
        note('fontFamily', cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''), el);
        note('fontSize', String(fontSize), el);
        note('fontWeight', cs.fontWeight, el);
      }
      noteColor('backgroundColor', cs.backgroundColor, el);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (px(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') { noteColor('borderColor', cs[`border${side}Color`], el); break; }
      }
      // Padding and gap are authored values; horizontal margins are skipped because
      // "margin: auto" computes to arbitrary pixel values and would be pure noise.
      const sp = new Set([cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.rowGap, cs.columnGap, cs.marginTop, cs.marginBottom].map(px).filter((n) => n !== null && n > 0));
      for (const n of sp) note('spacing', String(n), el);
      const rad = px(cs.borderTopLeftRadius);
      if (rad > 0 && !cs.borderTopLeftRadius.includes('%')) note('radius', String(Math.min(rad, 9999)), el);
    }

    /* ---- layout checks ---- */
    if (pageOverflows && (r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed') overflowers.push(el);

    if (ownText) {
      if (fontSize !== null && fontSize < minFontSize) add('small-text', 'minor', `Text renders at ${fontSize}px, below the ${minFontSize}px minimum.`, el);
      const clipX = ['hidden', 'clip'].includes(cs.overflowX);
      if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1) {
        if (clipX && cs.textOverflow === 'ellipsis') add('text-truncated', 'info', 'Text is truncated with an ellipsis here — check the full value is reachable (tooltip, expand, detail view).', el);
        else if (clipX) add('text-clipped', 'major', 'Text is cut off by its container with no ellipsis.', el);
        else if (cs.overflowX === 'visible' && !['td', 'th'].includes(tag)) add('text-overflows-container', 'major', 'Text spills outside its container (long word/label does not wrap or the container is too narrow).', el);
      }
      if (['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 3 && (cs.webkitLineClamp === 'none' || !cs.webkitLineClamp)) {
        add('text-clipped-vertical', 'major', 'Text is cut off vertically by a fixed-height container.', el);
      }
      const len = (el.innerText || '').length;
      if (len > 200 && fontSize && r.width / (fontSize * 0.5) > 100) add('long-line-length', 'minor', `Paragraph lines run ~${Math.round(r.width / (fontSize * 0.5))} characters; 45–90 is comfortable to read.`, el);
    }

    if (!ownText && !inSvg && ['hidden', 'clip'].includes(cs.overflowY) && el.clientHeight > 20 && el.scrollHeight > el.clientHeight + 8 && (el.innerText || '').trim() && (!cs.webkitLineClamp || cs.webkitLineClamp === 'none')) {
      add('content-clipped', 'minor', `Container is ${el.clientHeight}px tall but its content needs ${el.scrollHeight}px, and the overflow is hidden. Confirm nothing the user needs is cut off (fixed heights break with longer text, translation and larger fonts).`, el);
    }
    if (el.matches(INTERACTIVE) && !el.disabled) {
      let box = r;
      if (tag === 'input' && ['checkbox', 'radio'].includes(el.type) && el.labels && el.labels[0]) box = el.labels[0].getBoundingClientRect();
      const inlineLink = tag === 'a' && cs.display === 'inline' && el.parentElement && (el.parentElement.innerText || '').length > (el.innerText || '').length + 20;
      if (!inlineLink && box.width > 1 && box.height > 1) {
        const w = Math.round(box.width); const h = Math.round(box.height);
        if (w < 24 || h < 24) add('target-size', 'major', `Interactive target is ${w}×${h}px; WCAG 2.5.8 (AA) needs 24×24 unless spacing compensates.`, el, { wcag: '2.5.8' });
        else if (touch && (w < minTouchTarget || h < minTouchTarget)) add('touch-target-small', 'minor', `Touch target is ${w}×${h}px on a touch viewport; aim for ${minTouchTarget}×${minTouchTarget}.`, el);
      }
      if (['input', 'textarea', 'select'].includes(tag) && !['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'range', 'file', 'hidden'].includes(el.type)) {
        const labelled = (el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
        if (!labelled && el.getAttribute('placeholder')) add('placeholder-as-label', 'major', 'Field uses its placeholder as the only label; it disappears on input and is not a reliable accessible name.', el, { wcag: '3.3.2' });
      }
    } else if (cs.cursor === 'pointer' && !inSvg && !el.closest(INTERACTIVE) && !el.querySelector(INTERACTIVE) && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') && tag !== 'label') {
      add('clickable-not-focusable', 'major', 'Element looks clickable (pointer cursor) but is not a button/link and has no role or tabindex, so keyboard and screen-reader users cannot use it.', el, { wcag: '2.1.1' });
    }

    if (tag === 'img') {
      if (el.complete && el.naturalWidth === 0) add('broken-image', 'major', `Image failed to load: ${el.currentSrc || el.src}`, el);
      else if (el.naturalWidth && cs.objectFit === 'fill') {
        const a = el.naturalWidth / el.naturalHeight; const b = r.width / r.height;
        if (Math.abs(a - b) / a > 0.06) add('distorted-image', 'minor', `Image is stretched (natural ratio ${a.toFixed(2)}, rendered ${b.toFixed(2)}).`, el);
      }
    }
  }

  if (pageOverflows) {
    const scrollsItself = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return true; } return false; };
    const outer = overflowers.filter((el) => !scrollsItself(el) && !overflowers.includes(el.parentElement)).slice(0, 5);
    findings.push({
      rule: 'horizontal-scroll', severity: 'major', wcag: '1.4.10',
      message: `Page scrolls horizontally at ${vw}px (content is ${document.documentElement.scrollWidth}px wide). Likely culprits listed.`,
      culprits: outer.map(desc),
      ...(outer[0] ? desc(outer[0]) : {}),
    });
  }

  for (const f of document.fonts) {
    if (f.status === 'error') findings.push({ rule: 'font-failed-to-load', severity: 'major', message: `Web font "${f.family}" failed to load, so text falls back to another typeface.` });
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
    .filter((h) => h.getBoundingClientRect().height > 0)
    .slice(0, 60)
    .map((h) => ({ level: +(h.getAttribute('aria-level') || h.tagName[1]) || 2, text: (h.innerText || '').trim().slice(0, 70) }));

  let scroller = null;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (!['auto', 'scroll'].includes(cs.overflowY) || el.scrollHeight <= el.clientHeight + 80) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > 0.35 * innerWidth * innerHeight && (!scroller || r.width * r.height > scroller.area)) scroller = { el, area: r.width * r.height };
  }
  if (scroller) scroller.el.setAttribute('data-dr-scroller', '1');

  return {
    findings, ruleCounts: perRule, inventory: inv, headings,
    meta: {
      title: document.title, lang: document.documentElement.lang || null,
      docWidth: document.documentElement.scrollWidth, docHeight: Math.ceil(Math.min(document.documentElement.scrollHeight, maxBottom || Infinity)),
      elementCount: all.length, bodyTextLength: (document.body.innerText || '').trim().length,
      innerScroller: scroller ? { scrollHeight: scroller.el.scrollHeight, clientHeight: scroller.el.clientHeight } : null,
      errorOverlay: !!document.querySelector('vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal [data-nextjs-dialog], iframe#react-refresh-overlay'),
    },
  };
}

/* Checks drawn from usability literature rather than from a spec: wayfinding
   (can I tell where I am?), scannability, wording, signifiers, slips waiting
   to happen. They are heuristics — each finding says what to verify. */
function inPageUx({ ignoreSelectors }) {
  const { desc, textOf } = window.__dr;
  const findings = [];
  const perRule = {};
  const add = (rule, severity, message, el, extra) => {
    perRule[rule] = (perRule[rule] || 0) + 1;
    if (perRule[rule] > 10) return;
    findings.push({ rule, severity, message, ...(el ? desc(el) : {}), ...(extra || {}) });
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01; };
  const ignored = (el) => el.closest('[data-dr-overlay]') || ignoreSelectors.some((s) => { try { return !!el.closest(s); } catch { return false; } });
  const q = (sel, root = document) => [...root.querySelectorAll(sel)].filter((el) => vis(el) && !ignored(el));
  const words = (s) => new Set((s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
  const shares = (a, b) => { const B = words(b); return [...words(a)].some((w) => B.has(w) || [...B].some((x) => x.startsWith(w.slice(0, 5)) && w.length > 4)); };

  /* ---- wayfinding: site, page name, sections, "you are here", search ---- */
  const h1 = q('h1,[role=heading][aria-level="1"]')[0];
  const navs = q('nav,[role=navigation]');
  const way = { title: document.title, pageHeading: h1 ? textOf(h1) : null, navs: [], breadcrumb: q('[aria-label*=breadcrumb i],[class*=breadcrumb i]').length > 0, search: q('input[type=search],[role=search],input[placeholder*=search i],input[aria-label*=search i]').length > 0, homeLink: q('a[href="/"],a[aria-label*=home i],header a:has(img),header a:has(svg)').length > 0 };
  if (/^(vite( \+ react)?( \+ ts)?( app)?|react app|create next app|document|untitled|localhost.*)$/i.test(document.title.trim())) add('default-document-title', 'minor', `The browser tab still shows a scaffold title ("${document.title}"). Each page needs its own name there — it is what users see in tabs, history and bookmarks.`);
  const CUR = '[aria-current]:not([aria-current=false]),[aria-selected=true]';
  let currentLabel = null;
  for (const nav of navs) {
    if (nav.matches('[aria-label*=breadcrumb i],[class*=breadcrumb i]')) continue;
    const items = q('a[href],button,[role=tab],[role=menuitem],[role=link]', nav).filter((a) => textOf(a));
    if (items.length < 3) continue;
    const sig = (a) => { const c = getComputedStyle(a); return [c.color, c.backgroundColor, c.fontWeight, c.textDecorationLine, c.borderBottomWidth + c.borderBottomColor, c.borderLeftWidth + c.borderLeftColor, c.boxShadow].join('|'); };
    const groups = {};
    for (const a of items) (groups[sig(a)] ||= []).push(a);
    const odd = Object.values(groups).filter((g) => g.length === 1 && items.length > 2).map((g) => g[0]);
    const marked = items.filter((a) => a.matches(CUR) || a.querySelector(CUR));
    way.navs.push({ items: items.slice(0, 14).map(textOf), markedCurrent: marked.map(textOf), visuallyDistinct: odd.map(textOf) });
    if (marked[0]) currentLabel = textOf(marked[0]); else if (odd.length === 1) currentLabel = currentLabel || textOf(odd[0]);
    if (!marked.length && !odd.length) add('no-current-location', 'minor', `Navigation with ${items.length} items shows no "you are here": every item looks the same and none is marked as current. Users dropped onto this page cannot tell where they are.`, nav);
    else if (!marked.length && odd.length === 1) add('current-location-not-exposed', 'minor', `"${textOf(odd[0])}" looks like the current item but is not marked with aria-current, so assistive technology does not announce it.`, odd[0], { wcag: '1.3.1' });
    else if (marked.length && Object.keys(groups).length === 1) add('current-location-not-visible', 'minor', `"${textOf(marked[0])}" is marked aria-current but looks exactly like the other items. The cue has to be obvious, not subtle.`, marked[0]);
  }
  way.current = currentLabel;
  if (h1 && currentLabel && !shares(currentLabel, textOf(h1))) add('page-name-mismatch', 'info', `The navigation calls this place "${currentLabel}" but the page heading says "${textOf(h1)}". The page name should match what was clicked to get here.`, h1);
  if (h1 && document.title && !shares(textOf(h1), document.title)) add('title-heading-mismatch', 'info', `Tab title "${document.title}" does not include the page name "${textOf(h1)}". With several tabs or history entries open, every page of the app looks the same.`, h1);

  /* ---- scannability ---- */
  for (const h of q('h1,h2,h3,h4,h5,h6')) {
    if (h.closest('nav,[role=navigation],[role=dialog]')) continue;
    // Nearest visible neighbour above/below, climbing out of wrappers the heading is first/last in.
    const sib = (dir) => {
      for (let node = h, depth = 0; node && node !== document.body && depth < 4; node = node.parentElement, depth++) {
        let e = node[dir];
        while (e && !vis(e)) e = e[dir];
        if (e) return e;
      }
      return null;
    };
    const prev = sib('previousElementSibling'); const next = sib('nextElementSibling');
    if (!prev || !next || /^H[1-6]$/.test(prev.tagName)) continue;
    const r = h.getBoundingClientRect(); const above = r.top - prev.getBoundingClientRect().bottom; const below = next.getBoundingClientRect().top - r.bottom;
    if (above < -1 || below < -1) continue; // side by side, not stacked
    if (below > above + 2 && below >= 8) add('floating-heading', 'minor', `Heading floats: ${Math.round(above)}px to the content above but ${Math.round(below)}px to the section it introduces. A heading must sit closer to what it labels.`, h);
  }
  for (const p of q('p,li,dd,blockquote')) {
    const len = (p.innerText || '').trim().length;
    if (len > 800 && !p.closest('article,[role=article]')) add('wall-of-text', 'minor', `One block of ${len} characters. People scan interfaces rather than read them: break it up, lead with the point, or cut it.`, p);
  }

  /* ---- wording ---- */
  for (const a of q('a[href],[role=link]')) {
    const t = textOf(a);
    if (/^(click here|here|read more|learn more|more|more info|details|link|this|this page|continue reading)\.?$/i.test(t) && !a.getAttribute('aria-label') && !a.getAttribute('aria-labelledby')) add('vague-link-text', 'minor', `Link text "${t}" says nothing about where it leads. Links should carry their own scent — and screen-reader users hear them out of context.`, a, { wcag: '2.4.4' });
  }
  for (const b of q('button,[role=button],input[type=submit],input[type=button]')) {
    const t = textOf(b);
    const inDialog = b.closest('[role=dialog],[role=alertdialog],dialog');
    if (inDialog && /^(ok|okay|yes|no|confirm|submit)$/i.test(t)) add('generic-dialog-button', 'minor', `Dialog button "${t}" does not say what will happen. Name the action and its object ("Delete order", "Keep editing") so the consequence is visible without reading the body text.`, b);
    else if (!inDialog && /^(submit|ok|okay)$/i.test(t)) add('generic-button-label', 'info', `Button "${t}" is generic. A verb plus object ("Create order", "Save changes") removes a question from the user's head.`, b);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(), i = 0; n && i < 8000; n = walker.nextNode(), i++) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el || el.closest('script,style,noscript,code,pre,textarea,[data-dr-overlay]') || !vis(el) || ignored(el)) continue;
    if (/^(undefined|null|NaN)$/.test(t) || /\bundefined\b|\bNaN\b|\[object Object\]/.test(t)) add('debug-value-shown', 'major', `Users see a raw program value ("${t.slice(0, 40)}"). A missing or invalid value needs a designed presentation (a dash, "Not set", a fallback).`, el);
    else if (/lorem ipsum|dolor sit amet/i.test(t) || /\b(TODO|FIXME|TBD)\b/.test(t)) add('placeholder-content', 'major', `Placeholder text is on screen ("${t.slice(0, 40)}…"). Real content is a requirement of the screen, not something to fill in later.`, el);
    else if (/(exception|stack ?trace|errno|ECONN\w+|\b(Type|Reference|Syntax|Range)Error\b|status code \d{3}|\bat \w[\w.$]* \(.*:\d+:\d+\)|Unexpected token|is not a function|Cannot read propert)/i.test(t)) add('technical-error-shown', 'major', `A technical error message is shown to users ("${t.slice(0, 60)}"). Say what happened in their terms and what they can do next.`, el);
    else if (/^[a-z][a-z0-9]*([._][a-z][a-zA-Z0-9]*){1,5}$/.test(t) && /[._]/.test(t) && !/\.(com|org|net|io|dev|app|co|json|png|jpg|svg|pdf|csv|js|ts|tsx|jsx|md|txt|html|css)$/i.test(t) && !el.closest('a')) add('untranslated-key', 'info', `"${t}" looks like a translation key or identifier rather than words for a person.`, el);
  }

  /* ---- signifiers and slips ---- */
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[,/ ]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  for (const el of q('a[href],button,[role=button],[role=link]')) {
    if (el.closest('nav,[role=navigation],[role=menu],[role=menubar],[role=tablist],[role=toolbar],[role=listbox],[role=tree],th,[role=columnheader]') || el.querySelector('svg,img,i') || el.disabled) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!own || !el.parentElement) continue;
    const c = getComputedStyle(el); const pc = getComputedStyle(el.parentElement);
    const bordered = ['Top', 'Bottom', 'Left', 'Right'].some((s) => parseFloat(c[`border${s}Width`]) > 0 && c[`border${s}Style`] !== 'none' && alpha(c[`border${s}Color`]) > 0.05);
    if (alpha(c.backgroundColor) < 0.05 && !bordered && c.textDecorationLine === 'none' && c.boxShadow === 'none' && c.color === pc.color && c.fontWeight === pc.fontWeight) add('weak-signifier', 'minor', `"${textOf(el)}" is interactive but looks exactly like the plain text around it (same color and weight, no underline, border or fill). Nothing signals that it can be clicked — and touch users have no hover to find out.`, el);
  }
  const DESTRUCTIVE = /^(delete|remove|discard|destroy|erase|reset|clear all|deactivate|revoke|cancel (order|subscription|account|plan))\b/i;
  for (const b of q('button,[role=button]')) {
    if (!DESTRUCTIVE.test(textOf(b)) || !b.parentElement) continue;
    const c = getComputedStyle(b); const r = b.getBoundingClientRect();
    for (const o of q('button,[role=button]', b.parentElement)) {
      if (o === b || DESTRUCTIVE.test(textOf(o)) || !textOf(o)) continue;
      const oc = getComputedStyle(o); const or = o.getBoundingClientRect();
      const gap = Math.max(or.left - r.right, r.left - or.right, or.top - r.bottom, r.top - or.bottom);
      if (gap < 24 && oc.backgroundColor === c.backgroundColor && oc.color === c.color && oc.borderTopColor === c.borderTopColor) {
        add('destructive-not-distinct', 'minor', `"${textOf(b)}" is styled identically to "${textOf(o)}" and sits ${Math.max(0, Math.round(gap))}px away. Controls that look alike and sit together invite the wrong click; make the destructive one distinct, move it apart, or make it undoable.`, b);
        break;
      }
    }
  }

  /* ---- forms ---- */
  const forms = [];
  const containers = q('form,[role=form]');
  for (const f of containers.length ? containers : [document.body]) {
    const fields = q('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea', f);
    if (!fields.length) continue;
    const required = fields.filter((x) => x.required || x.getAttribute('aria-required') === 'true').length;
    forms.push({ fields: fields.length, required });
    if (fields.length > 10) add('long-form', 'info', `Form asks for ${fields.length} things at once (${required} marked required). Check each is needed for this task now; split into steps or defer the rest.`, f === document.body ? fields[0] : f);
    for (const x of fields) {
      if (x.tagName !== 'INPUT' || (x.type !== 'text' && x.type !== '')) continue;
      const hint = [x.name, x.id, x.getAttribute('autocomplete'), x.getAttribute('placeholder'), x.labels && x.labels[0] && x.labels[0].innerText].filter(Boolean).join(' ').toLowerCase();
      const want = /e-?mail/.test(hint) ? 'email' : /\b(phone|tel|mobile)\b/.test(hint) ? 'tel' : null;
      if (want && x.getAttribute('inputmode') !== want) add('wrong-input-type', 'minor', `This looks like ${want === 'email' ? 'an email' : 'a phone'} field but is type="text". type="${want}" gives phone users the right keyboard and lets browsers autofill.`, x, { wcag: '1.3.5' });
    }
  }
  return { findings, ruleCounts: perRule, wayfinding: way, forms };
}

/* ----------------------------------------------------- capture pieces */

async function gotoWithRetry(page, url, timeoutMs) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return res;
    } catch (e) {
      lastErr = e;
      if (!/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ECONNREFUSED|ERR_CONNECTION_RESET/.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Could not reach ${url} within ${timeoutMs}ms — is the dev server running? (${lastErr && lastErr.message.split('\n')[0]})`);
}

/* After a click or key press, did anything visibly change — and how soon? An
   action with no perceptible result leaves the user guessing whether it worked. */
async function actWithFeedback(page, fb, label, hoverFirst, act) {
  const shot = () => page.screenshot({ animations: 'disabled', caret: 'hide' });
  try {
    if (hoverFirst) { await hoverFirst(); await page.waitForTimeout(150); } // so the hover style is not mistaken for the response
    const url = page.url();
    const before = await shot();
    await act();
    await page.waitForTimeout(150);
    const T = 60;
    let d = await diffClips(fb.diffPage, before, await shot());
    const immediate = d.changed >= T || page.url() !== url;
    let eventual = immediate;
    if (!immediate) { await page.waitForTimeout(1100); d = await diffClips(fb.diffPage, before, await shot()); eventual = d.changed >= T || page.url() !== url; }
    fb.records.push({ action: label, immediate, eventual });
  } catch (e) {
    if (/Timeout|intercepts pointer|not visible|strict mode/.test(String(e.message))) throw e;
    fb.records.push({ action: label, error: String(e.message).split('\n')[0] });
  }
}

async function runActions(page, actions = [], fb = null) {
  for (const a of actions) {
    const [[kind, arg]] = Object.entries(a);
    const sel = typeof arg === 'object' && arg !== null && !Array.isArray(arg) ? arg.selector : Array.isArray(arg) ? arg[0] : arg;
    const val = typeof arg === 'object' && arg !== null && !Array.isArray(arg) ? arg.value : Array.isArray(arg) ? arg[1] : undefined;
    switch (kind) {
      case 'click':
        if (fb) await actWithFeedback(page, fb, `click ${sel}`, () => page.locator(sel).first().hover(), () => page.locator(sel).first().click());
        else {
          try { await page.locator(sel).first().click({ timeout: 5000 }); } catch (e) {
            // Still reach the state so it can be reviewed, but say so: a pointer could not get to the control.
            await page.locator(sel).first().evaluate((el) => el.click());
            if (page.__drNotes) page.__drNotes.push(`click ${sel}: the control could not be clicked with a pointer (${/intercepts/.test(e.message) ? 'another element covers it' : 'not reachable'}); the state was reached by script instead. Check the layout at this viewport — this is often a side effect of the page being wider than the screen.`);
          }
        }
        break;
      case 'hover': await page.locator(sel).first().hover(); break;
      case 'focus': await page.locator(sel).first().focus(); break;
      case 'fill': await page.locator(sel).first().fill(String(val ?? '')); break;
      case 'select': await page.locator(sel).first().selectOption(String(val)); break;
      case 'press':
        if (fb) await actWithFeedback(page, fb, `press ${arg}`, null, () => page.keyboard.press(String(arg)));
        else await page.keyboard.press(String(arg));
        break;
      case 'scroll': await page.locator(sel).first().scrollIntoViewIfNeeded(); break;
      case 'waitFor': await page.locator(sel).first().waitFor({ state: 'visible', timeout: 15000 }); break;
      case 'wait': await page.waitForTimeout(Number(arg)); break;
      default: throw new Error(`Unknown action "${kind}". Use click, hover, focus, fill, select, press, scroll, waitFor, wait.`);
    }
  }
}

async function settle(page, { waitFor, settleMs }) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (waitFor) await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  // Scroll through once so lazy-loaded content and scroll-triggered sections are present.
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += innerHeight) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

async function collectPerf(page) {
  return page.evaluate(() => new Promise((res) => {
    let cls = 0; let lcp = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => { const es = l.getEntries(); if (es.length) lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* unsupported browser */ }
    setTimeout(() => res({ cls: Math.round(cls * 1000) / 1000, lcpMs: Math.round(lcp) }), 60);
  })).catch(() => null);
}

/* WCAG 1.4.12: users may widen line, letter and word spacing; nothing may be lost when they do. */
async function textSpacingPass(page, file) {
  const before = await page.evaluate(() => window.__dr.clipped());
  await page.evaluate(() => {
    const st = document.createElement('style'); st.setAttribute('data-dr-spacing', '1');
    st.textContent = '*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p{margin-bottom:2em !important}';
    document.head.appendChild(st);
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__dr.clipped());
  const had = new Set(before.list.map((x) => x.key));
  const fresh = after.list.filter((x) => !had.has(x.key));
  const findings = fresh.slice(0, 8).map((x) => ({ rule: 'text-spacing-breaks', severity: 'major', wcag: '1.4.12', message: `With user text spacing applied (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em) this ${x.kind.startsWith('container') ? x.kind : `text ${x.kind}`}. Fixed heights/widths around text are the usual cause.`, ...pick(x) }));
  if (after.hscroll && !before.hscroll) findings.push({ rule: 'text-spacing-breaks', severity: 'major', wcag: '1.4.12', message: 'With user text spacing applied the page starts to scroll horizontally.', selector: 'html' });
  let shot = null;
  if (findings.length) { await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' }); shot = file; }
  await page.evaluate(() => document.querySelectorAll('[data-dr-spacing]').forEach((e) => e.remove()));
  await page.waitForTimeout(80);
  return { findings, shot };
}

/* Raise the browser's default font size (16 -> 32px), as a low-vision user would in
   settings, and see whether the text follows and whether the layout survives it. */
async function largeTextPass(bigPage, normal, file) {
  await bigPage.evaluate(installHelpers);
  const res = await bigPage.evaluate((normalSizes) => {
    const els = window.__dr.textEls();
    const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
    let fixed = [];
    let share;
    if (sizes.length === normalSizes.length) {
      fixed = els.filter((e, i) => sizes[i] / normalSizes[i] < 1.1);
      share = fixed.length / (els.length || 1);
    } else {
      const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
      share = avg(sizes) / avg(normalSizes) < 1.15 ? 1 : 0;
      fixed = share ? els.slice(0, 3) : [];
    }
    return { share, total: els.length, examples: fixed.slice(0, 3).map((e) => window.__dr.desc(e)), clip: window.__dr.clipped() };
  }, normal.sizes);
  const findings = [];
  const pct = Math.round(res.share * 100);
  if (res.share >= 0.5) {
    findings.push({ rule: 'text-ignores-user-font-size', severity: 'minor', message: `${pct}% of the text keeps its size when the browser's default font size is doubled — it is set in fixed pixels. People who enlarge text in their settings get no benefit (page zoom still works). Size text in rem.`, ...(res.examples[0] ? pick(res.examples[0]) : {}) });
  }
  if (res.share < 0.9) {
    const had = new Set(normal.clip.list.map((x) => x.key));
    for (const x of res.clip.list.filter((c) => !had.has(c.key)).slice(0, 8)) findings.push({ rule: 'breaks-at-large-text', severity: 'major', wcag: '1.4.4', message: `At a doubled default font size this ${x.kind.startsWith('container') ? x.kind : `text ${x.kind}`}.`, ...pick(x) });
    if (res.clip.hscroll && !normal.clip.hscroll) findings.push({ rule: 'breaks-at-large-text', severity: 'major', wcag: '1.4.4', message: 'At a doubled default font size the page scrolls horizontally.', selector: 'html' });
  }
  await bigPage.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  return { findings, fixedShare: pct };
}

async function takeShots(page, base, vp, meta) {
  const shots = [];
  const opt = { animations: 'disabled', caret: 'hide' };
  const fold = `${base}__fold.png`;
  await page.screenshot({ path: fold, ...opt });
  shots.push({ kind: 'fold', file: fold });
  const H = Math.max(vp.height, meta.docHeight);
  if (H > vp.height * 1.15) {
    // Tiles instead of one very tall image: tall screenshots get downscaled by vision
    // models until text is unreadable, which defeats the point of looking at them.
    const tileH = Math.max(vp.height, 1100);
    const n = Math.min(Math.ceil(H / tileH), 6);
    for (let i = 0; i < n; i++) {
      const y = i * tileH;
      const file = `${base}__full-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: vp.width, height: Math.min(tileH, H - y) }, ...opt });
      shots.push({ kind: 'full', file, y });
    }
    if (Math.ceil(H / tileH) > n) shots.push({ kind: 'note', note: `Page is ${H}px tall; only the first ${n * tileH}px were captured.` });
  } else if (meta.innerScroller) {
    // App-shell layouts scroll an inner container, so a "full page" shot only shows the first screen.
    const { scrollHeight, clientHeight } = meta.innerScroller;
    const n = Math.min(Math.ceil(scrollHeight / clientHeight), 5);
    for (let i = 1; i < n; i++) {
      await page.evaluate((top) => { const el = document.querySelector('[data-dr-scroller]'); if (el) el.scrollTop = top; }, i * clientHeight * 0.9);
      await page.waitForTimeout(120);
      const file = `${base}__scroll-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: file, ...opt });
      shots.push({ kind: 'scroll', file });
    }
    await page.evaluate(() => { const el = document.querySelector('[data-dr-scroller]'); if (el) el.scrollTop = 0; });
  }
  return shots;
}

async function runAxe(page, axeSource, { tags, exclude }) {
  await page.evaluate(axeSource);
  return page.evaluate(async ({ tags, exclude }) => {
    const ctx = exclude.length ? { exclude: exclude.map((s) => [s]) } : document;
    const res = await window.axe.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const { desc } = window.__dr;
    const pack = (list) => list.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
      wcag: v.tags.filter((t) => /^wcag\d{3,}$/.test(t)).map((t) => t.slice(4).split('').join('.').replace(/^(\d)\.(\d)\.(.+)$/, (_, a, b, c) => `${a}.${b}.${c.replace(/\./g, '')}`)),
      bestPractice: v.tags.includes('best-practice'),
      nodes: v.nodes.slice(0, 8).map((n) => {
        let el = null;
        try { el = document.querySelector(n.target[n.target.length - 1]); } catch { /* shadow / iframe target */ }
        const d = el ? desc(el) : { selector: String(n.target.join(' ')) };
        return { ...d, axeTarget: n.target.join(' '), detail: (n.failureSummary || '').replace(/Fix (any|all) of the following:/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) };
      }),
      nodeCount: v.nodes.length,
    }));
    return { violations: pack(res.violations), incomplete: pack(res.incomplete.filter((v) => v.id === 'color-contrast')) };
  }, { tags, exclude });
}

/* Compare two PNG clips inside a scratch page (no image library needed). */
async function diffClips(diffPage, a, b) {
  return diffPage.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width); const h = Math.min(ia.height, ib.height);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, w, h).data;
    const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    let changed = 0; let strong = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) {
        changed++;
        const l1 = lum(da[i], da[i + 1], da[i + 2]); const l2 = lum(db[i], db[i + 1], db[i + 2]);
        if ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) >= 3) strong++;
      }
    }
    return { changed, strong, total: w * h };
  }, [a.toString('base64'), b.toString('base64')]);
}

async function focusWalk(page, diffPage, { maxTabs, file, vp }) {
  const findings = [];
  const stops = [];
  await page.evaluate(() => { scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  let truncated = false;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    const info = await page.evaluate((i) => {
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      if (el.hasAttribute('data-dr-focus')) return { repeat: +el.getAttribute('data-dr-focus') };
      el.setAttribute('data-dr-focus', String(i));
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible = r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
      let obscuredBy = null;
      if (visible) {
        const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
        const isLabel = top && el.labels && [...el.labels].some((l) => l === top || l.contains(top));
        if (top && top !== el && !el.contains(top) && !top.contains(el) && !isLabel) obscuredBy = window.__dr.selectorOf(top);
      }
      return { ...window.__dr.desc(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), visible, obscuredBy, vrect: { x: r.left, y: r.top, w: r.width, h: r.height } };
    }, i);
    if (!info) { if (stops.length) break; continue; }
    if (info.repeat !== undefined) {
      const last = stops[stops.length - 1];
      if (last && last.index === info.repeat && stops.length > 1) {
        findings.push({ rule: 'keyboard-trap', severity: 'critical', wcag: '2.1.2', message: 'Pressing Tab does not move focus away from this element — possible keyboard trap (confirm manually; rich editors and grids may handle Tab on purpose).', selector: last.selector, text: last.text, component: last.component, file: last.file });
      }
      break;
    }
    const stop = { index: i, order: stops.length + 1, ...info };
    stops.push(stop);
    if (!info.visible) {
      findings.push({ rule: 'focus-on-invisible-element', severity: 'major', wcag: '2.4.7', message: `Tab stop #${stop.order} lands on an element that is not visible, so keyboard users lose track of focus.`, ...pick(info) });
      continue;
    }
    if (info.obscuredBy) findings.push({ rule: 'focus-obscured', severity: 'major', wcag: '2.4.11', message: `Tab stop #${stop.order} is covered by ${info.obscuredBy} when focused (sticky header/footer or overlay?). Verify on the screenshot.`, ...pick(info) });
    const pad = 8;
    const clip = { x: Math.max(0, info.vrect.x - pad), y: Math.max(0, info.vrect.y - pad) };
    clip.width = Math.min(vp.width, info.vrect.x + info.vrect.w + pad) - clip.x;
    clip.height = Math.min(vp.height, info.vrect.y + info.vrect.h + pad) - clip.y;
    if (clip.width < 4 || clip.height < 4) continue;
    try {
      const sel = `[data-dr-focus="${i}"]`;
      const focused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      await page.evaluate((s) => document.querySelector(s) && document.querySelector(s).blur(), sel);
      const blurred = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      await page.evaluate((s) => document.querySelector(s) && document.querySelector(s).focus({ preventScroll: true }), sel);
      const d = await diffClips(diffPage, focused, blurred);
      const perimeter = 2 * (info.vrect.w + info.vrect.h) * (vp.deviceScaleFactor || 1);
      stop.focusIndicator = d.changed < 16 ? 'none' : d.strong < perimeter * 0.6 ? 'weak' : 'ok';
      if (stop.focusIndicator === 'none') findings.push({ rule: 'focus-not-visible', severity: 'major', wcag: '2.4.7', message: `Tab stop #${stop.order} shows no visible change when focused (outline removed?).`, ...pick(info) });
      else if (stop.focusIndicator === 'weak') findings.push({ rule: 'focus-indicator-weak', severity: 'minor', wcag: '2.4.13', message: `Tab stop #${stop.order} has a focus indicator, but it is faint or thin (low-contrast change). Check it against the corporate focus style.`, ...pick(info) });
    } catch { /* element moved or detached mid-walk; skip the indicator check for it */ }
    if (i === maxTabs - 1) truncated = true;
  }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1].rect; const b = stops[i].rect;
    if (b.y + b.h < a.y - 40) findings.push({ rule: 'focus-order-jump', severity: 'info', wcag: '2.4.3', message: `Focus jumps upward from stop #${stops[i - 1].order} to #${stops[i].order}. Fine between columns/regions; a problem if it breaks reading order — check the focus-order screenshot.`, ...pick(stops[i]) });
  }
  // Numbered overlay so the tab order can be judged visually against the layout.
  await page.evaluate((stops) => {
    const root = document.createElement('div');
    root.setAttribute('data-dr-overlay', '1');
    root.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    for (const s of stops) {
      const c = { none: '#d4002a', weak: '#b35c00', ok: '#0a6b2d' }[s.focusIndicator] || '#444';
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${s.rect.x}px;top:${s.rect.y}px;width:${s.rect.w}px;height:${s.rect.h}px;outline:2px solid ${c};outline-offset:1px;box-sizing:border-box;`;
      const tag = document.createElement('div');
      tag.textContent = s.order;
      tag.style.cssText = `position:absolute;left:${Math.max(0, s.rect.x - 4)}px;top:${Math.max(0, s.rect.y - 10)}px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:${c};color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;box-sizing:border-box;`;
      root.append(box, tag);
    }
    document.body.appendChild(root);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    scrollTo(0, 0);
  }, stops.map((s) => ({ order: s.order, rect: s.rect, focusIndicator: s.focusIndicator })));
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(H, 4000) }, animations: 'disabled' });
  await page.evaluate(() => {
    document.querySelectorAll('[data-dr-overlay]').forEach((e) => e.remove());
    document.querySelectorAll('[data-dr-focus]').forEach((e) => e.removeAttribute('data-dr-focus'));
  });
  return { findings, stops: stops.map(({ vrect, index, ...s }) => s), truncated };
}

const pick = ({ selector, text, component, file, rect }) => ({ selector, text, component, file, rect });

/* ------------------------------------------------------- token checks */

function toPxList(x) {
  if (!x) return [];
  const entries = Array.isArray(x) ? x.map((v) => [String(v), v]) : Object.entries(x);
  const out = [];
  for (const [name, v] of entries) {
    if (name.startsWith('_')) continue;
    const s = String(typeof v === 'object' && v !== null ? v.value ?? v.$value : v).trim();
    const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(s);
    if (m) out.push({ name, px: Math.round(parseFloat(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1) * 100) / 100 });
  }
  return out;
}

function flattenColors(obj, prefix = '') {
  const out = [];
  if (!obj) return out;
  if (Array.isArray(obj)) return obj.map((v) => ({ name: String(v), value: String(v) }));
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_') || k.startsWith('$')) continue;
    const name = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push({ name, value: v });
    else if (v && typeof v === 'object') {
      const leaf = v.value ?? v.$value;
      if (typeof leaf === 'string') out.push({ name, value: leaf }); else out.push(...flattenColors(v, name));
    }
  }
  return out;
}

function tokenFindings(inv, tokens) {
  const f = [];
  const sample = (e) => ({ ...pick(e.samples[0] || {}), uses: e.count, examples: e.samples.slice(1).map((s) => s.selector) });
  if (tokens.colors.length) {
    for (const cat of ['textColor', 'backgroundColor', 'borderColor']) {
      for (const [value, e] of Object.entries(inv[cat])) {
        if (e.token || tokens.ignoreColors.includes(value.toLowerCase())) continue;
        f.push({ rule: `off-token-${cat.replace(/Color$/, '').toLowerCase()}-color`, severity: 'major', message: `${cat === 'textColor' ? 'Text' : cat === 'backgroundColor' ? 'Background' : 'Border'} color ${value} is not in the corporate palette${e.nearest ? `; nearest token is ${e.nearest}` : ''}.`, value, ...sample(e) });
      }
    }
  }
  if (tokens.fontFamily.length) {
    for (const [value, e] of Object.entries(inv.fontFamily)) {
      if (!tokens.fontFamily.includes(value.toLowerCase())) f.push({ rule: 'off-token-font-family', severity: 'major', message: `Font family "${value}" is not a corporate typeface (allowed: ${tokens.fontFamily.join(', ')}).`, value, ...sample(e) });
    }
  }
  const scale = (cat, list, rule, label, tol = 0.5) => {
    if (!list.length) return;
    for (const [value, e] of Object.entries(inv[cat])) {
      const n = parseFloat(value);
      if (list.some((t) => Math.abs(t.px - n) <= tol)) continue;
      const near = list.reduce((a, b) => (Math.abs(b.px - n) < Math.abs(a.px - n) ? b : a));
      f.push({ rule, severity: 'minor', message: `${label} ${value}px is off the corporate scale; nearest step is ${near.px}px${near.name !== String(near.px) ? ` (${near.name})` : ''}.`, value, ...sample(e) });
    }
  };
  scale('fontSize', tokens.fontSize, 'off-token-font-size', 'Font size');
  scale('spacing', tokens.spacing, 'off-token-spacing', 'Spacing (padding/gap/vertical margin)');
  scale('radius', tokens.radius, 'off-token-radius', 'Border radius');
  if (tokens.fontWeight.length) {
    for (const [value, e] of Object.entries(inv.fontWeight)) {
      if (!tokens.fontWeight.includes(Number(value))) f.push({ rule: 'off-token-font-weight', severity: 'minor', message: `Font weight ${value} is not in the corporate set (${tokens.fontWeight.join(', ')}).`, value, ...sample(e) });
    }
  }
  return f;
}

function loadTokens(file) {
  const empty = { loaded: false, colors: [], ignoreColors: [], fontFamily: [], fontSize: [], fontWeight: [], spacing: [], radius: [] };
  if (!file || !existsSync(file)) return { ...empty, status: `No tokens file at ${file} — token compliance was skipped.` };
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { ...empty, status: `Could not parse ${file}: ${e.message}` }; }
  if (raw._template) return { ...empty, status: `${file} is still the unedited template — token compliance was skipped. Fill it with the corporate tokens (see design-system/README.md).` };
  const fam = raw.fontFamily ? (Array.isArray(raw.fontFamily) ? raw.fontFamily : Object.values(raw.fontFamily)) : [];
  return {
    loaded: true, status: `Tokens loaded from ${file}`,
    colors: flattenColors(raw.color || raw.colors),
    ignoreColors: (raw.ignoreColors || []).map((c) => String(c).toLowerCase()),
    fontFamily: fam.flatMap((f) => String(f).split(',')).map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean),
    fontSize: toPxList(raw.fontSize), fontWeight: (Array.isArray(raw.fontWeight) ? raw.fontWeight : Object.values(raw.fontWeight || {})).map(Number).filter(Number.isFinite),
    spacing: toPxList(raw.spacing), radius: toPxList(raw.radius),
    minFontSize: raw.minFontSize, minTouchTarget: raw.minTouchTarget,
  };
}

/* ---------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help') || args.flags.has('h')) { console.log(HELP); return 0; }

  let cfg = {};
  if (args.config) cfg = JSON.parse(await fs.readFile(args.config, 'utf8'));
  const pages = [...(cfg.pages || [])];
  for (const u of args.url) pages.push({ url: u, name: args.url.length === 1 && args.name ? args.name : undefined });
  if (!pages.length) { console.error('Nothing to review: pass --url <url> or --config <file>.\n' + HELP); return 1; }
  for (const p of pages) {
    p.url = p.url || new URL(p.path || '/', cfg.baseUrl).toString();
    p.name = slug(p.name || new URL(p.url).pathname.replace(/\/$/, '') || 'home');
  }

  const viewports = resolveViewports(args.viewports || cfg.viewports);
  const themes = String(args.themes || (cfg.themes || ['light']).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const outRoot = path.resolve(args.out || cfg.out || '.design-review');
  const outDir = path.join(outRoot, slug(args.label || 'latest'));
  const shotsDir = path.join(outDir, 'shots');
  const tokensFile = path.resolve(args.tokens || cfg.tokens || path.join(SKILL_ROOT, 'design-system', 'tokens.json'));
  const tokens = args.flags.has('no-tokens') ? { ...loadTokens(null), status: 'Token compliance disabled (--no-tokens).' } : loadTokens(tokensFile);
  const minFontSize = Number(cfg.minFontSize || tokens.minFontSize || 12);
  const minTouchTarget = Number(cfg.minTouchTarget || tokens.minTouchTarget || 44);
  const ignoreSelectors = cfg.ignoreSelectors || [];
  const maxTabs = Number(args['max-tabs'] || cfg.maxTabs || 40);
  const settleMs = Number(args.settle || cfg.settle || 400);
  const axeTags = cfg.axeTags || ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

  const pw = loadDep(['playwright', '@playwright/test', 'playwright-core']);
  if (!pw) { console.error(`Playwright is not installed. Run:\n  npm install --prefix "${HERE}"\n  npx --prefix "${HERE}" playwright install chromium`); return 1; }
  const axe = args.flags.has('no-axe') ? null : loadDep(['axe-core']);
  const axeSource = axe ? await fs.readFile(path.join(path.dirname(axe.file), 'axe.min.js'), 'utf8') : null;
  const notes = [];
  if (!axe && !args.flags.has('no-axe')) notes.push(`axe-core is not installed, so the WCAG audit was skipped. Run: npm install --prefix "${HERE}"`);
  notes.push(tokens.status);

  let previous = null;
  try { previous = JSON.parse(await fs.readFile(path.join(outDir, 'report.json'), 'utf8')); } catch { /* first run */ }
  await fs.rm(shotsDir, { recursive: true, force: true });
  await fs.mkdir(shotsDir, { recursive: true });

  const launchOpts = {
    headless: !args.flags.has('headed'),
    ...(args.channel || cfg.channel ? { channel: args.channel || cfg.channel } : {}),
    ...(args['browser-path'] || process.env.DESIGN_REVIEW_BROWSER ? { executablePath: args['browser-path'] || process.env.DESIGN_REVIEW_BROWSER } : {}),
  };
  let browser;
  let bigBrowser = null; // second browser with a doubled default font size, started on first use
  try {
    browser = await pw.mod.chromium.launch(launchOpts);
  } catch (e) {
    console.error(`Could not launch the browser: ${e.message.split('\n')[0]}\nEither run: npx --prefix "${HERE}" playwright install chromium\nor reuse an installed browser: --channel chrome | --channel msedge | --browser-path <exe>`);
    return 1;
  }

  const raw = []; // every finding, before de-duplication across viewports/themes
  const captures = [];
  const focusVp = viewports.find((v) => v.name === 'desktop') || viewports[viewports.length - 1];
  const storageState = args['storage-state'] || (cfg.auth && cfg.auth.storageState);

  /* Navigate to a page, apply the theme, wait until it is stable, then drive it into the requested state. */
  const loadView = async (page, { pg, st, theme, fb }) => {
    await gotoWithRetry(page, pg.url, Number(args['server-timeout'] || 60000));
    const themeSetup = cfg.themeSetup && cfg.themeSetup[theme];
    if (themeSetup) {
      await page.evaluate((t) => {
        if (t.attr) document.documentElement.setAttribute(t.attr[0], t.attr[1]);
        if (t.class) document.documentElement.classList.add(t.class);
        if (t.localStorage) for (const [k, v] of Object.entries(t.localStorage)) localStorage.setItem(k, v);
      }, themeSetup);
      if (themeSetup.localStorage) await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await settle(page, { waitFor: args['wait-for'] || pg.waitFor, settleMs });
    const perf = await collectPerf(page);
    await runActions(page, (pg.actions && st.name !== 'default' ? pg.actions : []).concat(st.actions || []), fb);
    if ((st.actions || []).length) await page.waitForTimeout(settleMs);
    await page.evaluate(installHelpers);
    return perf;
  };
  const skip = (name) => args.flags.has(`no-${name}`);

  for (const vp of viewports) {
    for (const theme of themes) {
      const ctxOpts = {
        viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
        colorScheme: theme === 'dark' ? 'dark' : 'light', bypassCSP: true, ...(storageState ? { storageState } : {}), ...(cfg.locale ? { locale: cfg.locale } : {}),
      };
      const context = await browser.newContext(ctxOpts);
      const isFocus = vp.name === focusVp.name && theme === themes[0]; // the one viewport/theme that gets the slower interaction checks
      const diffPage = await context.newPage();
      const page = await context.newPage();
      page.setDefaultTimeout(10000); // a wrong selector in a state's actions should fail fast, not stall the run
      page.__drNotes = [];
      const runtime = { console: [], requests: [] };
      page.on('console', (m) => { if (m.type() === 'error') runtime.console.push(m.text().slice(0, 300)); });
      page.on('pageerror', (e) => runtime.console.push(`Uncaught: ${String(e.message).slice(0, 300)}`));
      page.on('requestfailed', (r) => { if (!/favicon|hot-update|sockjs|\/@vite/.test(r.url())) runtime.requests.push(`${r.method()} ${r.url()} — ${r.failure() ? r.failure().errorText : 'failed'}`); });
      page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) runtime.requests.push(`${r.status()} ${r.url()}`); });

      for (const pg of pages) {
        const states = [{ name: 'default', actions: pg.actions || [] }, ...(pg.states || [])];
        for (const st of states) {
          const where = { page: pg.name, state: slug(st.name), viewport: vp.name, theme };
          const base = path.join(shotsDir, [pg.name, where.state, vp.name, theme].join('__'));
          const tag = `${pg.name}/${where.state} @ ${vp.name}/${theme}`;
          runtime.console.length = 0; runtime.requests.length = 0;
          try {
            const fb = isFocus && !skip('feedback') ? { diffPage, records: [] } : null;
            page.__drNotes.length = 0;
            const perf = await loadView(page, { pg, st, theme, fb });
            for (const n of page.__drNotes) raw.push({ ...where, source: 'runtime', rule: 'control-not-clickable', severity: 'minor', message: n, value: n.slice(0, 60) });

            const audit = await page.evaluate(inPageAudit, { touch: vp.hasTouch, minTouchTarget, minFontSize, ignoreSelectors, tokenColors: tokens.colors, maxElements: 6000 });
            const cap = { ...where, url: pg.url, title: audit.meta.title, lang: audit.meta.lang, docHeight: audit.meta.docHeight, headings: audit.headings, shots: [] };
            cap.shots = await takeShots(page, base, vp, audit.meta);
            await page.evaluate(() => document.querySelectorAll('[data-dr-scroller]').forEach((e) => e.removeAttribute('data-dr-scroller')));

            if (audit.meta.errorOverlay) raw.push({ ...where, source: 'runtime', rule: 'error-overlay', severity: 'critical', message: 'The dev-server error overlay is showing — the app has a build/runtime error. Fix that before judging the design.' });
            if (audit.meta.bodyTextLength === 0 && audit.meta.elementCount < 8) raw.push({ ...where, source: 'runtime', rule: 'blank-page', severity: 'critical', message: 'The page rendered blank (no text, almost no elements). Wrong URL, failed render, or missing --wait-for?' });
            for (const m of [...new Set(runtime.console)].slice(0, 8)) raw.push({ ...where, source: 'runtime', rule: 'console-error', severity: 'minor', message: `Console error: ${m}`, value: m.slice(0, 80) });
            for (const m of [...new Set(runtime.requests)].slice(0, 8)) raw.push({ ...where, source: 'runtime', rule: 'failed-request', severity: 'minor', message: `Failed request: ${m}`, value: m.slice(0, 120) });

            if (!args.flags.has('no-layout')) for (const f of audit.findings) raw.push({ ...where, source: 'layout', ...f });
            if (tokens.loaded) for (const f of tokenFindings(audit.inventory, tokens)) raw.push({ ...where, source: 'tokens', ...f });
            if (perf) {
              cap.perf = perf;
              if (perf.cls > 0.1) raw.push({ ...where, source: 'perf', rule: 'layout-shift', severity: perf.cls > 0.25 ? 'major' : 'minor', message: `Content jumps around while the page loads (cumulative layout shift ${perf.cls}; under 0.1 is good). Reserve space for images, async data and late-loading fonts.`, value: 'cls' });
              if (perf.lcpMs > 4000) raw.push({ ...where, source: 'perf', rule: 'slow-first-content', severity: 'info', message: `Main content took ${(perf.lcpMs / 1000).toFixed(1)}s to appear. Dev builds are slow, so treat this as a prompt to measure a production build — and to check a loading state is shown meanwhile.`, value: 'lcp' });
            }
            if (fb) {
              cap.actionFeedback = fb.records;
              for (const r of fb.records) {
                if (r.error) continue;
                if (!r.eventual) raw.push({ ...where, source: 'feedback', rule: 'no-feedback-after-action', severity: 'major', message: `Nothing visibly changed within ~1.3s of "${r.action}". Every action needs a perceptible result, or the user cannot tell whether it worked and will repeat it.`, value: r.action });
                else if (!r.immediate) raw.push({ ...where, source: 'feedback', rule: 'slow-feedback', severity: 'minor', message: `"${r.action}" showed no response in the first ~150ms, then the screen changed. Acknowledge the action at once (pressed/busy state, skeleton) even if the result takes longer. Measured on this build; confirm it is not just dev-server latency.`, value: r.action });
              }
            }
            if (!skip('ux')) {
              const ux = await page.evaluate(inPageUx, { ignoreSelectors });
              cap.wayfinding = ux.wayfinding;
              cap.forms = ux.forms;
              for (const f of ux.findings) raw.push({ ...where, source: 'ux', ...f });
            }
            cap.inventory = Object.fromEntries(Object.entries(audit.inventory).map(([k, v]) => [k, Object.entries(v).sort((a, b) => b[1].count - a[1].count).slice(0, 25).map(([value, e]) => ({ value, uses: e.count, token: e.token, example: e.samples[0] && e.samples[0].selector }))]));

            if (axeSource) {
              const res = await runAxe(page, axeSource, { tags: axeTags, exclude: ignoreSelectors });
              const sev = { critical: 'critical', serious: 'major', moderate: 'minor', minor: 'minor' };
              for (const v of res.violations) for (const n of v.nodes) raw.push({ ...where, source: 'axe', rule: v.id, severity: v.bestPractice && !v.wcag.length ? (sev[v.impact] === 'critical' ? 'major' : 'minor') : sev[v.impact] || 'minor', message: `${v.help}. ${n.detail}`, wcag: v.wcag.join(', ') || undefined, helpUrl: v.helpUrl, ...pick(n) });
              for (const v of res.incomplete) for (const n of v.nodes) raw.push({ ...where, source: 'axe', rule: 'contrast-needs-visual-check', severity: 'info', message: 'Contrast could not be measured automatically (text over an image, gradient or translucent layer). Judge it on the screenshot.', wcag: '1.4.3', ...pick(n) });
            }

            if (isFocus && !skip('text-checks')) {
              const normal = await page.evaluate(() => ({ sizes: window.__dr.textEls().map((e) => parseFloat(getComputedStyle(e).fontSize)), clip: window.__dr.clipped() }));
              const sp = await textSpacingPass(page, `${base}__text-spacing.png`);
              for (const f of sp.findings) raw.push({ ...where, source: 'resize', ...f });
              if (sp.shot) cap.shots.push({ kind: 'text-spacing', file: sp.shot });
              try {
                if (!bigBrowser) bigBrowser = await pw.mod.chromium.launch({ ...launchOpts, headless: true, args: ['--blink-settings=defaultFontSize=32'] });
                const bigCtx = await bigBrowser.newContext(ctxOpts);
                const bigPage = await bigCtx.newPage();
                bigPage.setDefaultTimeout(10000);
                try {
                  await loadView(bigPage, { pg, st, theme, fb: null });
                  const file = `${base}__large-text.png`;
                  const lt = await largeTextPass(bigPage, normal, file);
                  cap.shots.push({ kind: 'large-text', file });
                  cap.fixedTextShare = lt.fixedShare;
                  for (const f of lt.findings) raw.push({ ...where, source: 'resize', ...f });
                } finally { await bigCtx.close(); }
              } catch (e) {
                notes.push(`${tag}: large-text check skipped (${String(e.message).split('\n')[0]}).`);
              }
            }

            if (!skip('focus') && isFocus) {
              const file = `${base}__focus-order.png`;
              const fw = await focusWalk(page, diffPage, { maxTabs, file, vp });
              cap.shots.push({ kind: 'focus-order', file });
              cap.tabStops = fw.stops.map((s) => ({ order: s.order, selector: s.selector, text: s.text, component: s.component, focusIndicator: s.focusIndicator }));
              if (fw.truncated) notes.push(`${tag}: keyboard walk stopped after ${maxTabs} Tab presses; raise --max-tabs to cover the rest.`);
              if (!fw.stops.length) raw.push({ ...where, source: 'focus', rule: 'no-tab-stops', severity: 'major', wcag: '2.1.1', message: 'Tab never reached any element — nothing on this view is keyboard reachable.' });
              for (const f of fw.findings) raw.push({ ...where, source: 'focus', ...f });
            }
            cap.shots = cap.shots.map((s) => (s.file ? { ...s, file: path.relative(outDir, s.file) } : s));
            captures.push(cap);
            console.log(`  captured ${tag}`);
          } catch (e) {
            const msg = String(e.message).split('\n')[0];
            raw.push({ ...where, source: 'runtime', rule: 'capture-failed', severity: 'critical', message: `Could not capture this view: ${msg}`, value: msg.slice(0, 80) });
            console.log(`  FAILED   ${tag}: ${msg}`);
          }
        }
      }
      await context.close();
    }
  }
  await browser.close();
  if (bigBrowser) await bigBrowser.close();

  /* De-duplicate: the same problem on three viewports is one finding seen in three places. */
  const byKey = new Map();
  for (const f of raw) {
    const key = [f.page, f.source, f.rule, f.selector || f.value || ''].join('|');
    const seen = `${f.viewport}/${f.theme}`;
    const ex = byKey.get(key);
    if (ex) {
      const slot = `${f.state}@${seen}`;
      ex._n[slot] = (ex._n[slot] || 0) + 1;
      if (!ex.seenIn.includes(seen)) ex.seenIn.push(seen);
      if (!ex.states.includes(f.state)) ex.states.push(f.state);
      continue;
    }
    const { viewport, theme, state, ...rest } = f;
    byKey.set(key, { ...rest, states: [state], seenIn: [seen], _n: { [`${state}@${seen}`]: 1 } });
  }
  const findings = [...byKey.values()].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || a.rule.localeCompare(b.rule));
  findings.forEach((f, i) => { f.id = `A${String(i + 1).padStart(3, '0')}`; f.instances = Math.max(...Object.values(f._n)); delete f._n; });
  const counts = Object.fromEntries(SEV_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length]));

  const report = {
    tool: 'ui-design-review/capture', generatedAt: new Date().toISOString(), outDir,
    scope: { pages: pages.map((p) => ({ name: p.name, url: p.url, states: ['default', ...(p.states || []).map((s) => s.name)] })), viewports: viewports.map((v) => `${v.name} ${v.width}x${v.height}`), themes },
    checks: { axe: !!axeSource, layout: !skip('layout'), usability: !skip('ux'), focus: !skip('focus'), feedback: !skip('feedback'), textResize: !skip('text-checks'), tokens: tokens.loaded },
    notes: [...new Set(notes)], counts, findings, captures,
    previous: previous ? { generatedAt: previous.generatedAt, counts: previous.counts } : null,
  };
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(outDir, 'SUMMARY.md'), renderSummary(report, previous));

  console.log(`\nAutomated findings: ${SEV_ORDER.map((s) => `${counts[s]} ${s}`).join(', ')}`);
  if (previous) console.log(`Previous run:       ${SEV_ORDER.map((s) => `${previous.counts[s]} ${s}`).join(', ')}`);
  for (const n of report.notes) console.log(`note: ${n}`);
  console.log(`\nRead next: ${path.join(outDir, 'SUMMARY.md')}  (then open the screenshots it lists)`);

  const failOn = args['fail-on'];
  if (failOn && SEV_ORDER.slice(0, SEV_ORDER.indexOf(failOn) + 1).some((s) => counts[s] > 0)) return 2;
  return 0;
}

function renderSummary(r, previous) {
  const L = [];
  L.push('# Automated UI audit', '');
  L.push(`Generated ${r.generatedAt}`, '');
  L.push('This file covers only what a script can measure. It does not judge hierarchy, clarity, consistency or brand fit —', 'open the screenshots below and evaluate those yourself against the rubric and the corporate design rules.', '');
  L.push('## Scope', '');
  for (const p of r.scope.pages) L.push(`- **${p.name}** — ${p.url} (states: ${p.states.join(', ')})`);
  L.push(`- Viewports: ${r.scope.viewports.join(', ')}`, `- Themes: ${r.scope.themes.join(', ')}`);
  L.push(`- Checks run: ${Object.entries(r.checks).map(([k, v]) => `${k} ${v ? 'yes' : 'NO'}`).join(', ')}`, '');
  if (r.notes.length) { L.push('## Notes', ''); for (const n of r.notes) L.push(`- ${n}`); L.push(''); }
  L.push('## Counts', '');
  L.push('| Severity | Now |' + (previous ? ' Previous run |' : ''), '|---|---|' + (previous ? '---|' : ''));
  for (const s of SEV_ORDER) L.push(`| ${s} | ${r.counts[s]} |` + (previous ? ` ${previous.counts[s]} |` : ''));
  L.push('');
  if (previous) {
    const prevKeys = new Set((previous.findings || []).map((f) => [f.page, f.rule, f.selector || f.value || ''].join('|')));
    const nowKeys = new Set(r.findings.map((f) => [f.page, f.rule, f.selector || f.value || ''].join('|')));
    const fixed = (previous.findings || []).filter((f) => !nowKeys.has([f.page, f.rule, f.selector || f.value || ''].join('|')));
    const fresh = r.findings.filter((f) => !prevKeys.has([f.page, f.rule, f.selector || f.value || ''].join('|')));
    L.push(`Since the previous run: **${fixed.length} resolved**, **${fresh.length} new**.`, '');
    if (fresh.length) { L.push('New since the previous run (possible regressions):', ''); for (const f of fresh.slice(0, 20)) L.push(`- ${f.id} \`${f.rule}\` ${f.selector ? `at \`${f.selector}\`` : ''}`); L.push(''); }
  }
  L.push('## Screenshots to review', '');
  for (const c of r.captures) {
    L.push(`### ${c.page} / ${c.state} — ${c.viewport}, ${c.theme}`, '');
    const hint = { 'focus-order': ' — numbered tab order; red = no focus indicator, amber = weak, green = ok', 'large-text': " — same view with the browser's default font size doubled", 'text-spacing': ' — same view with user text spacing applied (something broke)' };
    for (const s of c.shots) L.push(s.file ? `- \`${s.file}\`${hint[s.kind] || ''}` : `- note: ${s.note}`);
    L.push('');
  }
  L.push('## Findings', '');
  if (!r.findings.length) L.push('No automated findings.', '');
  for (const sev of SEV_ORDER) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    L.push(`### ${sev[0].toUpperCase() + sev.slice(1)} (${list.length})`, '');
    for (const f of list) {
      L.push(`- **${f.id}** \`${f.source}:${f.rule}\`${f.wcag ? ` · WCAG ${f.wcag}` : ''} — ${f.message}`);
      const bits = [];
      if (f.selector) bits.push(`element \`${f.selector}\``);
      if (f.text) bits.push(`text "${f.text}"`);
      if (f.component) bits.push(`component ${f.component}`);
      if (f.file) bits.push(`source ${f.file}`);
      if (f.uses) bits.push(`${f.uses} uses`);
      if (f.instances > 1) bits.push(`${f.instances} similar elements`);
      bits.push(`page ${f.page}`, `state${f.states.length > 1 ? 's' : ''} ${f.states.slice(0, 4).join(', ')}${f.states.length > 4 ? ` +${f.states.length - 4}` : ''}`, `seen in ${f.seenIn.join(', ')}`);
      L.push(`  - ${bits.join(' · ')}`);
      if (f.culprits && f.culprits.length) L.push(`  - culprits: ${f.culprits.map((c) => `\`${c.selector}\` (${c.rect.w}px wide)`).join(', ')}`);
    }
    L.push('');
  }
  const wf = r.captures.filter((c) => c.wayfinding && c.viewport === (r.captures.find((x) => x.tabStops) || r.captures[0]).viewport && c.state === 'default');
  if (wf.length) {
    L.push('## Wayfinding (trunk test inputs)', '', 'Dropped onto this page with no context, could someone answer: what site is this, what page am I on, what are the main sections, where am I among them, how do I search?', '');
    for (const c of wf) {
      const w = c.wayfinding;
      L.push(`- **${c.page}** — tab title: "${w.title || '(none)'}" · page heading: ${w.pageHeading ? `"${w.pageHeading}"` : '**none**'} · home/logo link: ${w.homeLink ? 'yes' : 'no'} · search: ${w.search ? 'yes' : 'no'} · breadcrumb: ${w.breadcrumb ? 'yes' : 'no'}`);
      for (const n of w.navs) L.push(`  - nav: ${n.items.join(' | ')} → marked current: ${n.markedCurrent.join(', ') || 'none'}; visually distinct: ${n.visuallyDistinct.join(', ') || 'none'}`);
      if (!w.navs.length) L.push('  - no navigation region found on this view');
    }
    L.push('');
  }
  const fbCaps = r.captures.filter((c) => c.actionFeedback && c.actionFeedback.length);
  if (fbCaps.length) {
    L.push('## Feedback after actions', '', 'For each scripted click/key press: did the screen visibly respond within ~150ms, and at all within ~1.3s?', '');
    for (const c of fbCaps) for (const a of c.actionFeedback) L.push(`- ${c.page}/${c.state}: \`${a.action}\` → ${a.error ? `not measured (${a.error})` : a.immediate ? 'immediate response' : a.eventual ? 'delayed response' : '**no visible response**'}`);
    L.push('');
  }
  const pf = r.captures.filter((c) => c.perf && c.state === 'default');
  if (pf.length) {
    L.push('## Load behaviour', '');
    for (const c of pf) L.push(`- ${c.page} @ ${c.viewport}: main content at ${c.perf.lcpMs}ms, layout shift ${c.perf.cls}${c.fixedTextShare !== undefined ? `, ${c.fixedTextShare}% of text in fixed pixels` : ''}`);
    L.push('', 'Timings come from this build (usually the dev server); read them as relative, not absolute.', '');
  }
  const first = r.captures.find((c) => c.headings && c.headings.length);
  if (first) { L.push(`## Heading outline (${first.page}, ${first.viewport})`, ''); for (const h of first.headings) L.push(`${'  '.repeat(Math.max(0, h.level - 1))}- h${h.level}: ${h.text}`); L.push(''); }
  const tabs = r.captures.find((c) => c.tabStops && c.tabStops.length);
  if (tabs) { L.push(`## Tab order (${tabs.page}, ${tabs.viewport})`, ''); for (const t of tabs.tabStops) L.push(`${t.order}. \`${t.selector}\`${t.text ? ` "${t.text}"` : ''} — focus indicator: ${t.focusIndicator || 'not measured'}`); L.push(''); }
  const invCap = r.captures.find((c) => c.viewport === 'desktop' && c.inventory) || r.captures.find((c) => c.inventory);
  if (invCap) {
    L.push(`## Rendered style inventory (${invCap.page}, ${invCap.viewport})`, '', 'What is actually on screen. A long tail of one-off values usually means hard-coded styles instead of tokens.', '');
    const label = { textColor: 'Text colors', backgroundColor: 'Background colors', borderColor: 'Border colors', fontFamily: 'Font families', fontSize: 'Font sizes (px)', fontWeight: 'Font weights', spacing: 'Spacing values (px)', radius: 'Radii (px)' };
    for (const [k, list] of Object.entries(invCap.inventory)) {
      if (!list.length) continue;
      L.push(`- **${label[k]}** (${list.length}): ${list.slice(0, 16).map((e) => `${e.value}${e.token ? `=${e.token}` : ''}×${e.uses}`).join(', ')}`);
    }
    L.push('');
  }
  return L.join('\n');
}

main().then((code) => process.exit(code || 0)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });

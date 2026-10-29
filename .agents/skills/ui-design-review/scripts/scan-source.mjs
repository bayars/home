#!/usr/bin/env node
/**
 * scan-source.mjs — static scan of React source for design-system violations
 * that are invisible in a screenshot: raw HTML where a corporate component
 * exists, banned UI libraries, hard-coded colors/sizes instead of tokens, and
 * common accessibility anti-patterns.
 *
 * Usage:  node scan-source.mjs src/features/orders [more paths...]
 *         node scan-source.mjs --changed            (files changed vs git HEAD)
 *         node scan-source.mjs --changed --base main
 * Options: --components <file>  --tokens <file>  --out <dir>  --label <name>
 */
import fs from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..');
const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs']);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);
const SKIP_DIR = /(^|[\\/])(node_modules|dist|build|out|coverage|\.next|\.git|\.design-review|storybook-static|__snapshots__)([\\/]|$)/;
const SEV_ORDER = ['critical', 'major', 'minor', 'info'];

function parseArgs(argv) {
  const a = { paths: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) { a.paths.push(k); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--') || ['changed', 'help'].includes(k.slice(2))) a.flags.add(k.slice(2));
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

function readJson(file, what) {
  if (!existsSync(file)) return { data: null, status: `No ${what} file at ${file}` };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data._template) return { data: null, status: `${file} is still the unedited template — ${what} checks were skipped. Fill it in (see design-system/README.md).` };
    return { data, status: `${what} loaded from ${file}` };
  } catch (e) { return { data: null, status: `Could not parse ${file}: ${e.message}` }; }
}

async function walk(p, out) {
  if (SKIP_DIR.test(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) { for (const e of await fs.readdir(p)) await walk(path.join(p, e), out); return; }
  const ext = path.extname(p);
  if ((CODE_EXT.has(ext) || STYLE_EXT.has(ext)) && !/\.(test|spec|stories|d)\.[a-z]+$/.test(p)) out.push(p);
}

/* Find JSX opening tags, tolerating `>` inside {expressions} and strings. */
function openingTags(src) {
  const tags = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length; let depth = 0; let quote = null;
    for (; i < src.length && i < m.index + 4000; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth <= 0 && src[i - 1] !== '=') break;
    }
    tags.push({ name: m[1], text: src.slice(m.index, i + 1), index: m.index });
  }
  return tags;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*') + '$');

function scanFile(file, src, cfg) {
  const out = [];
  const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
  const ext = path.extname(file);
  const add = (rule, severity, index, message, fix) => out.push({ rule, severity, file: rel, line: lineOf(src, index), message, fix, snippet: src.slice(index, index + 110).split('\n')[0].trim() });
  const isTokenFile = cfg.tokenFiles.some((re) => re.test(rel));
  const isDsFile = cfg.componentFiles.some((re) => re.test(rel));
  // Strip comments but keep offsets so line numbers stay right.
  const code = src.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  if (!isTokenFile) {
    for (const m of code.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![\w-])|\b(?:rgba?|hsla?)\(\s*\d[^)]*\)/g)) {
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      if (/(href|id|url\(|#\/|&)[^\s]*$/.test(before) || /var\(--[\w-]+,\s*$/.test(before)) continue; // anchors, urls, var() fallbacks
      add('hardcoded-color', 'major', m.index, `Hard-coded color ${m[0]} — use a corporate color token instead.`, 'Replace with the matching token (CSS variable / theme value) from the design system.');
    }
    for (const m of code.matchAll(/\b[a-z-]+-\[(#[0-9a-fA-F]{3,8}|\d+(?:\.\d+)?(?:px|rem|em))\]/g)) add('arbitrary-utility-value', 'minor', m.index, `Arbitrary utility value "${m[0]}" bypasses the token scale.`, 'Use the nearest named utility from the corporate theme.');
    if (cfg.pxScale.length) {
      const reStyle = STYLE_EXT.has(ext)
        ? /(?:^|[;{\s])((?:margin|padding|gap|row-gap|column-gap|font-size|border-radius|top|left|right|bottom)[\w-]*)\s*:\s*([^;}\n]+)/g
        : /\b(margin\w*|padding\w*|gap|rowGap|columnGap|fontSize|borderRadius)\s*:\s*(['"`]?[^,}\n]+)/g;
      for (const m of code.matchAll(reStyle)) {
        for (const v of m[2].matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(px)?(?![\w.%])/g)) {
          const n = parseFloat(v[1]);
          if (!v[2] && STYLE_EXT.has(ext)) continue; // unitless numbers in CSS are not lengths
          if (n === 0 || n === 1 || cfg.pxScale.includes(n)) continue;
          add('off-scale-length', 'minor', m.index + m[0].indexOf(m[2]), `${m[1]}: ${n}px is not on the corporate spacing/type/radius scale.`, `Use a token; nearest scale step is ${cfg.pxScale.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))}px.`);
        }
      }
    }
  }
  for (const m of code.matchAll(/outline\s*:\s*(['"]?)(none|0)\b/g)) add('outline-removed', 'major', m.index, 'Focus outline removed. Keyboard users lose the focus indicator unless a replacement :focus-visible style exists.', 'Keep the corporate focus ring, or pair this with an explicit :focus-visible style.');
  if (STYLE_EXT.has(ext)) {
    // Content revealed only on :hover is invisible to touch and keyboard users.
    for (const m of code.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)) {
      if (!/(display|visibility|opacity)\s*:/.test(m[2]) || /:focus/.test(m[1])) continue;
      const base = m[1].split(',')[0].replace(/:hover/g, '').trim();
      if (base && code.includes(base.replace(/\s+/g, ' ') + ':focus')) continue;
      add('hover-only-reveal', 'major', m.index, `"${m[1].trim().slice(0, 70)}" shows or hides content on hover with no :focus/:focus-within equivalent. Touch screens have no hover and keyboard users never trigger it.`, 'Make the content always visible, or reveal it on focus and on tap as well.');
    }
  }
  for (const m of code.matchAll(/!important/g)) add('important', 'minor', m.index, '!important overrides the design system cascade.', 'Fix specificity or use the component\'s documented props/variants.');

  if (CODE_EXT.has(ext)) {
    for (const m of code.matchAll(/(?:from\s+|require\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const banned = cfg.bannedImports.find((b) => m[1] === b.name || m[1].startsWith(b.name + '/'));
      if (banned) add('banned-import', 'major', m.index, `Import from "${m[1]}" is not allowed${banned.reason ? ` (${banned.reason})` : ''}.`, banned.use ? `Use ${banned.use} instead.` : `Use ${cfg.packageName || 'the corporate component library'} instead.`);
    }
    for (const m of code.matchAll(/\b(?:window\.)?(alert|confirm|prompt)\(\s*['"`]/g)) add('native-dialog', 'minor', m.index, `Native ${m[1]}() dialog: unstyled, off-brand, and its buttons cannot name the action ("OK"/"Cancel").`, `Use ${cfg.rawElements.dialog || 'the corporate dialog/toast'}; for destructive actions prefer undo over an "Are you sure?" prompt.`);
    for (const m of code.matchAll(/\{\s*(?:String\()?\s*(\w*(?:err|error|exception|e)\w*)\??\.(message|stack|toString\(\))\s*\)?\s*\}/gi)) add('raw-error-rendered', 'major', m.index, `{${m[1]}.${m[2]}} renders the raw exception text to users.`, 'Map errors to written messages that say what happened in the user\'s terms and what to do next; log the technical detail instead.');
    for (const m of code.matchAll(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/g)) add('zoom-disabled', 'major', m.index, 'The viewport meta tag stops users from pinch-zooming.', 'Remove user-scalable=no / maximum-scale=1.');
    for (const [name, use] of Object.entries(cfg.deprecated)) {
      for (const m of code.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g'))) add('deprecated-component', 'minor', m.index, `<${name}> is deprecated in the design system.`, `Use ${use}.`);
    }
    if (/\.(tsx|jsx)$/.test(ext) || /<[A-Za-z]/.test(code)) {
      for (const t of openingTags(code)) {
        const raw = cfg.rawElements[t.name];
        if (raw && !isDsFile) add('raw-element', 'major', t.index, `Raw <${t.name}> used where the design system provides ${raw}.`, `Replace with ${raw}${cfg.packageName ? ` from ${cfg.packageName}` : ''} so styling, states and accessibility come from the shared component.`);
        if (/\sstyle=\{\{/.test(t.text) && !isDsFile) add('inline-style', 'minor', t.index, `Inline style on <${t.name}> — styling that bypasses tokens and component variants.`, 'Move to the component\'s props/variants or a token-based class.');
        if (/^(div|span|li|p|td|tr|section|article|img|svg)$/.test(t.name) && /\sonClick=/.test(t.text) && !/\s(role|tabIndex)=/.test(t.text)) add('click-on-non-interactive', 'major', t.index, `onClick on <${t.name}> without role/tabIndex — not reachable by keyboard or announced as a control.`, `Use ${cfg.rawElements.button || 'a <button>'} (or a link if it navigates).`);
        if (t.name === 'img' && !/\salt[=\s/>]/.test(t.text) && !/\{\.\.\./.test(t.text)) add('img-without-alt', 'major', t.index, '<img> has no alt attribute.', 'Add alt text, or alt="" if the image is decorative.');
        const cls = /\sclassName=(?:"([^"]*)"|\{`([^`]*)`\}|'([^']*)')/.exec(t.text);
        const cl = cls ? (cls[1] || cls[2] || cls[3] || '') : '';
        if (/(^|\s)(group-)?hover:(opacity-100|visible|block|flex|inline|inline-flex|grid)\b/.test(cl) && !/focus(-within|-visible)?:/.test(cl)) add('hover-only-reveal', 'major', t.index, `<${t.name}> is revealed only on hover (${(/(group-)?hover:[\w-]+/.exec(cl) || [''])[0]}). Touch screens have no hover and keyboard users never trigger it.`, 'Keep it visible, or add the matching focus/focus-within variant and a tap path.');
        if (/\sonPaste=\{[^}]*preventDefault/.test(t.text)) add('paste-blocked', 'major', t.index, `<${t.name}> blocks paste. That punishes users (and password managers) for not typing the way the form wants.`, 'Accept pasted input and clean it up in code.');
        if (/\s(maxLength|pattern)=/.test(t.text) && /(card|phone|tel|iban|postal|zip|ssn)/i.test(t.text)) add('strict-input-format', 'info', t.index, `<${t.name}> constrains the format of a number people write in different ways. Accept spaces, dashes and brackets and normalise them, rather than rejecting the input.`, 'Be liberal in what the field accepts; strip separators in code.');
        const ti = /\stabIndex=\{?["']?(\d+)/.exec(t.text);
        if (ti && Number(ti[1]) > 0) add('positive-tabindex', 'major', t.index, `tabIndex=${ti[1]} overrides the natural tab order.`, 'Use tabIndex 0 and fix DOM order instead.');
        if (/\sautoFocus[\s=/>]/.test(t.text)) add('autofocus', 'info', t.index, 'autoFocus moves focus on mount — fine in dialogs, disorienting on page load.', 'Confirm it is intentional.');
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help')) { console.log('Usage: node scan-source.mjs <paths...> | --changed [--base <ref>] [--components f] [--tokens f] [--out dir] [--label name]'); return 0; }
  const comp = readJson(path.resolve(args.components || path.join(SKILL_ROOT, 'design-system', 'components.json')), 'component rules');
  const tok = readJson(path.resolve(args.tokens || path.join(SKILL_ROOT, 'design-system', 'tokens.json')), 'tokens');
  const c = comp.data || {};
  const t = tok.data || {};
  const nums = (x) => (x ? (Array.isArray(x) ? x : Object.values(x)) : []).map((v) => { const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(String(v).trim()); return m ? parseFloat(m[1]) * (m[2] && m[2] !== 'px' ? 16 : 1) : NaN; }).filter(Number.isFinite);
  const cfg = {
    packageName: c.package || null,
    rawElements: c.rawElementReplacements || {},
    bannedImports: (c.bannedImports || []).map((b) => (typeof b === 'string' ? { name: b } : b)),
    deprecated: c.deprecated || {},
    tokenFiles: (c.tokenFiles || ['**/tokens/**', '**/theme/**', '**/*.tokens.*', '**/tailwind.config.*']).map(globToRe),
    componentFiles: (c.designSystemSourceGlobs || []).map(globToRe),
    pxScale: [...new Set([...nums(t.spacing), ...nums(t.fontSize), ...nums(t.radius)])],
  };

  let targets = [];
  if (args.flags.has('changed')) {
    try {
      const base = args.base || 'HEAD';
      const lines = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base], { encoding: 'utf8' }).split('\n')
        .concat(execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n'));
      targets = [...new Set(lines.filter(Boolean))].filter((f) => existsSync(f));
    } catch (e) { console.error(`--changed needs a git repository: ${e.message.split('\n')[0]}`); return 1; }
  }
  targets.push(...args.paths);
  if (!targets.length) { console.error('Nothing to scan: pass file/folder paths or --changed.'); return 1; }
  const files = [];
  for (const p of targets) { if (existsSync(p)) await walk(path.resolve(p), files); else console.error(`skip (not found): ${p}`); }

  const findings = [];
  for (const f of [...new Set(files)]) findings.push(...scanFile(f, await fs.readFile(f, 'utf8'), cfg));
  findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);
  findings.forEach((f, i) => { f.id = `S${String(i + 1).padStart(3, '0')}`; });
  const counts = Object.fromEntries(SEV_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const notes = [comp.status, tok.status];

  const outDir = path.join(path.resolve(args.out || '.design-review'), (args.label || 'latest').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'source-scan.json'), JSON.stringify({ tool: 'ui-design-review/scan-source', generatedAt: new Date().toISOString(), filesScanned: files.length, notes, counts, findings }, null, 2));

  const L = ['# Source scan', '', `${files.length} files scanned. ${SEV_ORDER.map((s) => `${counts[s]} ${s}`).join(', ')}.`, '', ...notes.map((n) => `- ${n}`), ''];
  const byRule = {};
  for (const f of findings) (byRule[f.rule] ||= []).push(f);
  for (const [rule, list] of Object.entries(byRule)) {
    const sameFix = list.every((f) => f.fix === list[0].fix);
    L.push(`## ${rule} (${list.length}, ${list[0].severity})`, '');
    if (sameFix) L.push(`Fix: ${list[0].fix}`, '');
    for (const f of list.slice(0, 40)) L.push(`- **${f.id}** \`${f.file}:${f.line}\` — ${f.message}${sameFix ? '' : ` ${f.fix}`}  \n  \`${f.snippet.replace(/`/g, "'")}\``);
    if (list.length > 40) L.push(`- …and ${list.length - 40} more (see source-scan.json)`);
    L.push('');
  }
  await fs.writeFile(path.join(outDir, 'SOURCE-SCAN.md'), L.join('\n'));
  console.log(`Scanned ${files.length} files: ${SEV_ORDER.map((s) => `${counts[s]} ${s}`).join(', ')}`);
  for (const n of notes) console.log(`note: ${n}`);
  console.log(`Read next: ${path.join(outDir, 'SOURCE-SCAN.md')}`);
  return 0;
}

main().then((c) => process.exit(c || 0)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });

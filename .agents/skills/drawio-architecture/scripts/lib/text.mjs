// Text measurement without a browser. Layout needs to know how wide a label
// will be before anything is rendered, so this uses the published advance
// widths of Helvetica (the font draw.io uses by default; Arial and Liberation
// Sans have the same metrics). Estimates are slightly generous on purpose: the
// check step measures the real rendered text afterwards.
const W = {};
const put = (chars, w) => { for (const c of chars) W[c] = w; };
put(" !,./:;I[\\]ft", 278); put("\"", 355); put("#$0123456789?L_abdeghnopqu", 556); put("%", 889); put("&ABEKPSVXY", 667);
put("'", 191); put("()-`r", 333); put("*", 389); put("+<=>~", 584); put("@", 1015); put("CDHNRUw", 722); put("FTZ", 611);
put("GOQ", 778); put("J", 500); put("M", 833); put("W", 944); put("^", 469); put("ijl", 222); put("cksvxyz", 500); put("m", 833);
put("{}", 334); put("|", 260);

const SAFETY = 1.04;

/** Width in px of a single line of text. */
export function lineWidth(text, fontSize = 12, bold = false) {
  let units = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    units += W[ch] ?? (cp > 0x2e7f ? 1000 : cp > 0xff ? 620 : 556);     // CJK is full width; other non-Latin gets an average
  }
  return Math.ceil(units / 1000 * fontSize * (bold ? 1.08 : 1) * SAFETY);
}

/** Greedy word wrap. Returns an array of lines; never splits a word. Honours explicit "\n". */
export function wrap(text, maxWidth, fontSize = 12, bold = false) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (line && lineWidth(next, fontSize, bold) > maxWidth) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Size of a block of lines. */
export function blockSize(lines, fontSize = 12, bold = false) {
  return { width: Math.max(0, ...lines.map(l => lineWidth(l, fontSize, bold))), height: Math.ceil(lines.length * fontSize * 1.2) };
}

export const escapeXml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#xa;").replace(/\t/g, " ");
/** Escape text for use inside an HTML label (the label itself is then XML-escaped as an attribute). */
export const escapeHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

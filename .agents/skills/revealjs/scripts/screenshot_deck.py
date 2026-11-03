#!/usr/bin/env python3
"""Render every slide of a reveal.js deck to PNGs for visual QA.

Usage:
    python screenshot_deck.py deck.html out_dir/ [--width 1280] [--height 720] [--fragments]

Walks the deck in navigation order using reveal.js's own API (so it follows the
same ←/→/↑/↓ grid the audience will), and writes slide-01.png, slide-02.png, ...
An OVERFLOW WARNING is printed for any slide whose content is taller/wider than
the slide frame — the single most common reveal.js layout bug.

Requires: playwright + a chromium binary
    pip install playwright --break-system-packages && playwright install chromium
"""
import argparse
import os
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("out_dir")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--fragments", action="store_true",
                    help="capture each fragment step separately (default: final state only)")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed. Run:\n"
              "  pip install playwright --break-system-packages && playwright install chromium",
              file=sys.stderr)
        return 1

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    url = "file://" + os.path.abspath(args.html)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": args.width, "height": args.height},
                                device_scale_factor=2)
        page.goto(url, wait_until="networkidle")
        # Wait until reveal.js has initialised.
        page.wait_for_function("() => window.Reveal && Reveal.isReady()", timeout=15000)
        # Webfonts change text metrics AFTER first layout — a top cause of phantom
        # overflow. Wait for fonts, then force reveal to recompute scale.
        try:
            page.evaluate("() => document.fonts && document.fonts.ready")
            page.wait_for_function("() => !document.fonts || document.fonts.status === 'loaded'",
                                   timeout=8000)
        except Exception:
            pass
        page.evaluate("() => window.Reveal && Reveal.layout && Reveal.layout()")
        page.wait_for_timeout(500)

        warnings = []
        idx = 0
        seen = set()
        while True:
            indices = page.evaluate("() => Reveal.getIndices()")
            key = (indices["h"], indices.get("v", 0),
                   indices.get("f", -1) if args.fragments else -1)
            if key not in seen:
                seen.add(key)
                idx += 1
                # Let the transition finish, then force a relayout so the scale is
                # correct for THIS slide before we capture (fast captures otherwise
                # grab a mid-transition frame and show phantom clipping).
                page.wait_for_timeout(550)
                page.evaluate("() => window.Reveal && Reveal.layout && Reveal.layout()")
                page.wait_for_timeout(120)
                shot = out / f"slide-{idx:02d}.png"
                page.screenshot(path=str(shot))

                # Overflow check, two kinds:
                #  1. the slide section is taller/wider than the deck's design box
                #     (content reveal has to downscale, or that escapes the frame)
                #  2. a scroll container (e.g. .slide-body) is clipping content
                #     internally — the safety net kicked in and the audience would
                #     have to scroll to see everything. Both are real problems.
                overflow = page.evaluate(
                    """() => {
                        const s = Reveal.getCurrentSlide();
                        if (!s) return null;
                        const cfg = Reveal.getConfig();
                        const dw = cfg.width, dh = cfg.height;
                        const frameY = Math.max(0, s.offsetHeight - dh);
                        const frameX = Math.max(0, s.offsetWidth - dw);
                        let clipY = 0, clipX = 0, who = '';
                        s.querySelectorAll('*').forEach(el => {
                            // Only elements that actually CLIP (overflow auto/scroll/hidden)
                            // hide content; overflow:visible just paints outside the box.
                            const cs = getComputedStyle(el);
                            const clips = /(auto|scroll|hidden)/;
                            const oy = clips.test(cs.overflowY) ? el.scrollHeight - el.clientHeight : 0;
                            const ox = clips.test(cs.overflowX) ? el.scrollWidth - el.clientWidth : 0;
                            if (oy > 4 || ox > 4) {
                                if (oy > clipY || ox > clipX) {
                                    clipY = Math.max(clipY, oy); clipX = Math.max(clipX, ox);
                                    who = el.className || el.tagName;
                                }
                            }
                        });
                        return {frameX, frameY, clipX, clipY, who};
                    }"""
                )
                if overflow and (overflow["frameY"] > 2 or overflow["frameX"] > 2):
                    warnings.append(f"slide-{idx:02d}.png is bigger than the design box "
                                    f"(x+{overflow['frameX']}px, y+{overflow['frameY']}px) — reveal must downscale it")
                if overflow and (overflow["clipY"] > 4 or overflow["clipX"] > 4):
                    warnings.append(f"slide-{idx:02d}.png clips content inside '{overflow['who']}' "
                                    f"(x+{overflow['clipX']}px, y+{overflow['clipY']}px) — audience must scroll to see it")

            if page.evaluate("() => Reveal.isLastSlide() && "
                             "(!Reveal.availableFragments || !Reveal.availableFragments().next)"):
                break
            before = page.evaluate("() => JSON.stringify(Reveal.getIndices())")
            page.evaluate("() => Reveal.next()")
            page.wait_for_timeout(60)
            after = page.evaluate("() => JSON.stringify(Reveal.getIndices())")
            if before == after:   # safety: nothing advanced, avoid infinite loop
                break

        browser.close()

    print(f"wrote {idx} slide image(s) to {out}/")
    if warnings:
        print("\nOVERFLOW WARNINGS:")
        for w in warnings:
            print("  ! " + w)
        return 2
    print("no overflow detected \u2014 every slide fits its frame")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

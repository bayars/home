// Runs inside the check page. Loads a diagram into the draw.io viewer and reads
// defects straight from the rendered result (real text sizes, real edge routes).
// Exposes window.drawioArch = { load, pageCount, pageNames, selectPage, inspect, setScale, clip }.
(function () {
  "use strict";
  var viewer = null;

  // theme "dark" shows the file the way a dark-theme draw.io does, which is how to see whether
  // a diagram depends on the theme. Checks and pictures use "light" unless asked otherwise.
  function load(token, theme) {
    var dark = theme === "dark";
    document.documentElement.style.background = document.body.style.background = dark ? "#121212" : "#ffffff";
    return fetch("d/" + token).then(function (r) {
      if (!r.ok) throw new Error("diagram not found on the local server");
      return r.text();
    }).then(function (xml) {
      var stage = document.getElementById("stage");
      stage.innerHTML = "";
      var div = document.createElement("div");
      div.className = "mxgraph";
      div.setAttribute("data-mxgraph", JSON.stringify({
        nav: false, resize: true, toolbar: "", "auto-fit": false, lightbox: false, "check-visible-state": false,
        "dark-mode": dark ? "dark" : "light", border: 10, xml: xml
      }));
      stage.appendChild(div);
      return new Promise(function (resolve, reject) {
        try {
          GraphViewer.createViewerForElement(div, function (v) {
            viewer = v;
            var tries = 0;
            (function wait() {
              if (viewer.graph) resolve({ pages: pageNames() });
              else if (++tries > 400) reject(new Error((div.innerText || "the viewer did not produce a diagram").slice(0, 300)));
              else setTimeout(wait, 25);
            })();
          });
        } catch (e) { reject(e); }
      });
    });
  }

  function pageNames() {
    if (!viewer || !viewer.diagrams || !viewer.diagrams.length) return ["Page-1"];
    return Array.prototype.map.call(viewer.diagrams, function (d, i) { return d.getAttribute("name") || "Page-" + (i + 1); });
  }

  function selectPage(i) {
    if (viewer.diagrams && viewer.diagrams.length > 1 && viewer.currentPage !== i) viewer.selectPage(i);
    // Measurements are only meaningful at 100%.
    var g = viewer.graph;
    if (Math.abs(g.view.scale - 1) > 1e-6) g.view.scaleAndTranslate(1, g.view.translate.x, g.view.translate.y);
    return true;
  }

  function setScale(s) {
    var g = viewer.graph;
    g.view.scaleAndTranslate(s, g.view.translate.x, g.view.translate.y);
    return clip();
  }

  // Screenshot rectangle in page coordinates, with a small margin.
  function clip() {
    var g = viewer.graph, b = g.getGraphBounds(), r = g.container.getBoundingClientRect(), m = 12;
    return { x: Math.max(0, Math.floor(r.left + window.scrollX + b.x - m)), y: Math.max(0, Math.floor(r.top + window.scrollY + b.y - m)),
      width: Math.ceil(b.width + 2 * m), height: Math.ceil(b.height + 2 * m), scale: g.view.scale };
  }

  var INNER_ICON = {
    "mxgraph.aws4.resourceIcon": ["resIcon", ""], "mxgraph.aws4.productIcon": ["prIcon", ""],
    "mxgraph.aws4.group": ["grIcon", ""], "mxgraph.aws4.groupCenter": ["grIcon", ""], "mxgraph.aws4.group2": ["grIcon", ""],
    "mxgraph.kubernetes.icon": ["prIcon", "mxgraph.kubernetes."], "mxgraph.kubernetes.icon2": ["prIcon", "mxgraph.kubernetes2."],
    "mxgraph.gcp2.hexIcon": ["prIcon", "mxgraph.gcp2."], "mxgraph.cisco19.rect": ["prIcon", "mxgraph.cisco19."]
  };

  function inspect() {
    var g = viewer.graph, m = g.getModel(), view = g.view;
    var findings = [], images = [];
    function add(severity, kind, ids, message) { findings.push({ severity: severity, kind: kind, ids: ids, message: message }); }
    function text(c) {
      var d = document.createElement("div"); d.innerHTML = String(g.getLabel(c) || "").replace(/<br\s*\/?>/gi, " ");
      var t = (d.textContent || "").replace(/\s+/g, " ").trim();
      return t.length > 40 ? t.slice(0, 39) + "…" : t;
    }
    function name(c) { var t = text(c); return '"' + c.id + '"' + (t ? " (" + t + ")" : ""); }
    function R(r) { return { x: r.x, y: r.y, w: r.width, h: r.height }; }
    function inter(a, b, pad) { pad = pad || 0; return a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h; }
    function inside(outer, inner, tol) { return inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.w <= outer.x + outer.w + tol && inner.y + inner.h <= outer.y + outer.h + tol; }
    function shrink(r, d) { return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d }; }
    function isAnc(a, c) { for (var p = m.getParent(c); p; p = m.getParent(p)) if (p === a) return true; return false; }
    function segHits(rect, p, q) { return mxUtils.rectangleIntersectsSegment(new mxRectangle(rect.x, rect.y, rect.w, rect.h), p, q); }

    var cells = [];
    for (var id in m.cells) { var c = m.cells[id]; if (c.vertex || c.edge) cells.push(c); }
    var V = [], E = [];
    cells.forEach(function (c) {
      var s = view.getState(c);
      if (!s) return;
      if (c.edge) { E.push({ c: c, s: s }); return; }
      var parent = m.getParent(c);
      var geo = m.getGeometry(c);
      var childVerts = 0;
      for (var i = 0; i < m.getChildCount(c); i++) if (m.getChildAt(c, i).vertex) childVerts++;
      V.push({ c: c, s: s, st: s.style, r: R(s), group: childVerts > 0,
        onEdge: !!(parent && parent.edge), part: s.style.part == "1" || !!(geo && geo.relative),
        label: s.text && s.text.boundingBox && s.text.boundingBox.width > 0 && text(c) ? R(s.text.boundingBox) : null });
    });

    // The background box: an unlabelled, unconnected rectangle that lies behind the other shapes.
    // Diagrams built by this skill keep it in a locked layer; people also draw one by hand so
    // that a diagram stays readable in draw.io's dark theme. It is scenery, not content, so it
    // is left out of the overlap checks below, and content is checked for sticking out of it.
    var order = {}, seq = 0;
    (function walk(c) { order[c.id] = seq++; for (var i = 0; i < m.getChildCount(c); i++) walk(m.getChildAt(c, i)); })(m.getRoot());
    function layerOf(c) { var root = m.getRoot(); while (c && m.getParent(c) !== root) c = m.getParent(c); return c; }
    function isLocked(c) { for (; c; c = m.getParent(c)) if (/(^|;)\s*locked=1\s*(;|$)/.test(String(c.style || ""))) return true; return false; }
    var solid = V.filter(function (v) { return !v.onEdge && !v.part; });
    var backdrop = null;
    solid.forEach(function (v) {
      var sh = v.st.shape;
      if (v.group || v.label || text(v.c) || m.getEdgeCount(v.c) > 0 || m.getParent(v.c) !== layerOf(v.c)) return;
      if (!(sh == null || sh === "rectangle" || sh === "label") || v.st.image != null || String(v.st.fillColor) === "none") return;
      var locked = isLocked(v.c), others = 0, held = 0, behind = true;
      solid.forEach(function (o) {
        if (o === v) return;
        others++;
        var cx = o.r.x + o.r.w / 2, cy = o.r.y + o.r.h / 2;
        if (cx > v.r.x && cx < v.r.x + v.r.w && cy > v.r.y && cy < v.r.y + v.r.h) { held++; if (order[o.c.id] < order[v.c.id]) behind = false; }
      });
      if (!behind) return;                                    // it covers what it surrounds: an ordinary shape in the wrong place
      if (locked ? held * 2 < others : (held < 2 || held * 3 < others * 2)) return;   // unlocked: it must lie behind at least two thirds of the shapes
      if (!backdrop || v.r.w * v.r.h > backdrop.r.w * backdrop.r.h) backdrop = { v: v, c: v.c, r: v.r, locked: locked };
    });
    var leaves = V.filter(function (v) { return !v.group && !v.onEdge && !v.part && !(backdrop && v === backdrop.v); });
    var groups = V.filter(function (v) { return v.group; });

    if (!cells.length) add("warning", "empty-page", [], "the page has no shapes or edges");

    // 1. shapes and icons that do not exist in draw.io
    V.forEach(function (v) {
      var shape = v.st.shape;
      if (shape && shape !== "image" && !mxCellRenderer.defaultShapes[shape] && !mxStencilRegistry.getStencil(shape))
        add("error", "unknown-shape", [v.c.id], name(v.c) + ' uses shape "' + shape + '", which draw.io does not have (it renders as a plain box)');
      var rule = INNER_ICON[shape];
      if (rule) {
        var val = v.st[rule[0]];
        if (val == null || val === "") add("error", "unknown-icon", [v.c.id], name(v.c) + " has no " + rule[0] + ", so the icon is blank");
        else if (!mxStencilRegistry.getStencil(rule[1] + val)) add("error", "unknown-icon", [v.c.id], name(v.c) + " uses " + rule[0] + '="' + val + '", which draw.io does not have (the icon is blank)');
      }
      if (v.st.image != null) images.push({ id: v.c.id, image: String(v.st.image) });
      var fs = Number(v.st.fontSize || 12);
      if (v.label && fs < 8) add("info", "tiny-text", [v.c.id], name(v.c) + " uses " + fs + "px text, which is hard to read");
    });

    // 2. labels that do not fit
    leaves.forEach(function (v) {
      if (!v.label) return;
      var insideLabel = (v.st.verticalLabelPosition || "middle") === "middle" && (v.st.labelPosition || "center") === "center";
      if (insideLabel && v.st.shape !== "image" && v.st.overflow !== "hidden" && v.st.overflow !== "fill" && v.st.text !== true && String(v.st.strokeColor) !== "none") {
        if (v.label.w > v.r.w + 2 || v.label.h > v.r.h + 2)
          add("warning", "label-overflow", [v.c.id], name(v.c) + ": the label needs " + Math.round(v.label.w) + "x" + Math.round(v.label.h) + " px but the shape is " + Math.round(v.r.w) + "x" + Math.round(v.r.h));
      }
      var p = m.getParent(v.c), ps = p && p.vertex ? view.getState(p) : null;
      if (ps && !inside(R(ps), v.label, 1)) add("warning", "label-outside-container", [v.c.id, p.id], "the label of " + name(v.c) + ' sticks out of its container "' + p.id + '"');
    });

    // 3. containers
    groups.forEach(function (gr) {
      var fs = Number(gr.st.fontSize || 12);
      if (gr.label && gr.label.h > fs * 2.1 && String(gr.st.horizontal) !== "0")
        add("warning", "title-wraps", [gr.c.id], "the title of container " + name(gr.c) + " wraps onto several lines because the container is only " + Math.round(gr.r.w) + " px wide");
      V.forEach(function (v) {
        if (v === gr || v.onEdge || (backdrop && v === backdrop.v)) return;
        if (m.getParent(v.c) === gr.c && !v.part) {
          if (!inside(gr.r, v.r, 1)) add("warning", "child-outside-container", [v.c.id, gr.c.id], name(v.c) + ' extends outside its container "' + gr.c.id + '"');
          if (gr.label && String(gr.st.horizontal) !== "0" && inter(shrink(gr.label, 1), v.r)) add("warning", "title-covered", [gr.c.id, v.c.id], "the title of container " + name(gr.c) + " is covered by " + name(v.c));
        } else if (!isAnc(gr.c, v.c) && !isAnc(v.c, gr.c) && !v.part) {
          var a = gr.r, b = v.r;
          if (inter(a, b, 1)) {
            if (v.group) { if (gr.c.id < v.c.id) add("warning", "container-overlap", [gr.c.id, v.c.id], "containers " + name(gr.c) + " and " + name(v.c) + " overlap but neither contains the other"); }
            else add("warning", "overlaps-container", [v.c.id, gr.c.id], name(v.c) + ' overlaps container "' + gr.c.id + '" but is not inside it (wrong parent, or a position that crosses the border)');
          }
        }
      });
    });

    // 4. shapes and labels on top of each other
    for (var i = 0; i < leaves.length; i++) for (var j = i + 1; j < leaves.length; j++) {
      var A = leaves[i], B = leaves[j];
      if (inter(A.r, B.r, 1)) add("warning", "overlap", [A.c.id, B.c.id], name(A.c) + " and " + name(B.c) + " overlap");
      else {
        if (A.label && inter(shrink(A.label, 1), B.r)) add("warning", "label-over-node", [A.c.id, B.c.id], "the label of " + name(A.c) + " runs over " + name(B.c));
        if (B.label && inter(shrink(B.label, 1), A.r)) add("warning", "label-over-node", [B.c.id, A.c.id], "the label of " + name(B.c) + " runs over " + name(A.c));
        if (A.label && B.label && inter(shrink(A.label, 1), shrink(B.label, 1))) add("warning", "label-over-label", [A.c.id, B.c.id], "the labels of " + name(A.c) + " and " + name(B.c) + " overlap");
      }
    }

    // 5. edges
    var routes = [];
    E.forEach(function (e) {
      var c = e.c, src = m.getTerminal(c, true), dst = m.getTerminal(c, false);
      var pts = (e.s.absolutePoints || []).filter(Boolean);
      var geo = m.getGeometry(c);
      if (!src && !(geo && geo.getTerminalPoint(true))) add("error", "dangling-edge", [c.id], "edge " + name(c) + " has no source");
      if (!dst && !(geo && geo.getTerminalPoint(false))) add("error", "dangling-edge", [c.id], "edge " + name(c) + " has no target");
      if (pts.length < 2) return;
      var lab = e.s.text && e.s.text.boundingBox && text(c) ? R(e.s.text.boundingBox) : null;
      routes.push({ c: c, pts: pts, src: src, dst: dst, label: lab });
      leaves.forEach(function (v) {
        if ((src && isAnc(v.c, src)) || (dst && isAnc(v.c, dst))) return;
        var own = v.c === src || v.c === dst;
        var body = shrink(v.r, 1), hit = false;
        if (own) {
          // An edge should stop at the border of the shape it connects to, not run on inside it.
          var endPt = v.c === dst ? pts[pts.length - 1] : pts[0], deep = shrink(v.r, Math.min(8, v.r.w / 4, v.r.h / 4));
          var rectangular = v.st.perimeter == null || v.st.perimeter === mxPerimeter.RectanglePerimeter;
          if (rectangular && endPt.x > deep.x && endPt.x < deep.x + deep.w && endPt.y > deep.y && endPt.y < deep.y + deep.h)
            add("warning", "edge-end-inside", [c.id, v.c.id], "edge " + name(c) + " ends inside " + name(v.c) + " instead of at its border");
          var gap = Math.max(v.r.x - endPt.x, endPt.x - (v.r.x + v.r.w), v.r.y - endPt.y, endPt.y - (v.r.y + v.r.h));
          if (gap > 6) add("warning", "edge-end-detached", [c.id, v.c.id], "edge " + name(c) + " stops " + Math.round(gap) + " px short of " + name(v.c));
        } else if (body.w > 0 && body.h > 0) for (var k = 0; k + 1 < pts.length && !hit; k++) hit = segHits(body, pts[k], pts[k + 1]);
        if (hit) add("warning", "edge-through-node", [c.id, v.c.id], "edge " + name(c) + " passes through " + name(v.c));
        else if (v.label && !(own && (v.st.verticalLabelPosition || "middle") === "middle" && (v.st.labelPosition || "center") === "center")) {
          var lb = shrink(v.label, 2), hit2 = false;
          if (lb.w > 0 && lb.h > 0) for (var k2 = 0; k2 + 1 < pts.length && !hit2; k2++) hit2 = segHits(lb, pts[k2], pts[k2 + 1]);
          if (hit2) add("warning", "edge-through-label", [c.id, v.c.id], "edge " + name(c) + " runs through the label of " + name(v.c) + (own ? ", which it connects to" : ""));
        }
        if (!own && lab && inter(shrink(lab, 1), v.r)) add("warning", "edge-label-over-node", [c.id, v.c.id], "the label of edge " + name(c) + " sits on top of " + name(v.c));
      });
      groups.forEach(function (gr) {
        if (lab && gr.label && String(gr.st.horizontal) !== "0" && inter(shrink(lab, 1), shrink(gr.label, 1))) add("warning", "edge-label-over-title", [c.id, gr.c.id], "the label of edge " + name(c) + " overlaps the title of container " + name(gr.c));
      });
    });
    var crossings = 0;
    function axis(p, q) { return Math.abs(p.x - q.x) < 0.5 ? "v" : Math.abs(p.y - q.y) < 0.5 ? "h" : null; }
    for (var a1 = 0; a1 < routes.length; a1++) for (var b1 = a1 + 1; b1 < routes.length; b1++) {
      var ra = routes[a1], rb = routes[b1];
      if (ra.label && rb.label && inter(shrink(ra.label, 1), shrink(rb.label, 1))) add("warning", "edge-label-overlap", [ra.c.id, rb.c.id], "the labels of edges " + name(ra.c) + " and " + name(rb.c) + " overlap");
      var shared = (ra.src && (ra.src === rb.src || ra.src === rb.dst)) || (ra.dst && (ra.dst === rb.dst || ra.dst === rb.src));
      var overlapLen = 0;
      for (var x1 = 0; x1 + 1 < ra.pts.length; x1++) for (var y1 = 0; y1 + 1 < rb.pts.length; y1++) {
        var p1 = ra.pts[x1], p2 = ra.pts[x1 + 1], q1 = rb.pts[y1], q2 = rb.pts[y1 + 1];
        var ax = axis(p1, p2), bx = axis(q1, q2);
        if (ax && ax === bx) {
          if (ax === "h" && Math.abs(p1.y - q1.y) < 1.5) overlapLen += Math.max(0, Math.min(Math.max(p1.x, p2.x), Math.max(q1.x, q2.x)) - Math.max(Math.min(p1.x, p2.x), Math.min(q1.x, q2.x)));
          if (ax === "v" && Math.abs(p1.x - q1.x) < 1.5) overlapLen += Math.max(0, Math.min(Math.max(p1.y, p2.y), Math.max(q1.y, q2.y)) - Math.max(Math.min(p1.y, p2.y), Math.min(q1.y, q2.y)));
        } else if (mxUtils.intersection(p1.x, p1.y, p2.x, p2.y, q1.x, q1.y, q2.x, q2.y)) {
          var ip = mxUtils.intersection(p1.x, p1.y, p2.x, p2.y, q1.x, q1.y, q2.x, q2.y);
          var atEnd = function (r) { var f = r.pts[0], l = r.pts[r.pts.length - 1]; return Math.hypot(ip.x - f.x, ip.y - f.y) < 2 || Math.hypot(ip.x - l.x, ip.y - l.y) < 2; };
          if (!(shared && (atEnd(ra) || atEnd(rb)))) crossings++;
        }
      }
      if (overlapLen > 24 && !shared) add("warning", "edge-overlap", [ra.c.id, rb.c.id], "edges " + name(ra.c) + " and " + name(rb.c) + " run on top of each other for " + Math.round(overlapLen) + " px, so they cannot be told apart");
    }

    // 6. the background
    var ext = null;                                            // everything drawn except the background box
    function grow(r) {
      if (!r || !(r.w >= 0) || !(r.h >= 0)) return;
      if (!ext) { ext = { x: r.x, y: r.y, x2: r.x + r.w, y2: r.y + r.h }; return; }
      ext.x = Math.min(ext.x, r.x); ext.y = Math.min(ext.y, r.y); ext.x2 = Math.max(ext.x2, r.x + r.w); ext.y2 = Math.max(ext.y2, r.y + r.h);
    }
    var outside = [];
    V.forEach(function (v) {
      if (backdrop && v === backdrop.v) return;
      grow(v.r); grow(v.label);
      if (backdrop && !v.onEdge && !v.part && (!inside(backdrop.r, v.r, 1) || (v.label && !inside(backdrop.r, v.label, 1)))) outside.push(v.c);
    });
    routes.forEach(function (r) {
      var out = false;
      r.pts.forEach(function (p) { var pr = { x: p.x, y: p.y, w: 0, h: 0 }; grow(pr); if (backdrop && !inside(backdrop.r, pr, 1)) out = true; });
      grow(r.label);
      if (backdrop && (out || (r.label && !inside(backdrop.r, r.label, 1)))) outside.push(r.c);
    });
    var adaptive = typeof g.getAdaptiveColors === "function" ? g.getAdaptiveColors() : (g.adaptiveColors || "auto");
    // Measured, not assumed: draw the page under the other theme and count what changes colour.
    function paint() {
      var els = g.container.querySelectorAll("svg *"), out = [];
      for (var i = 0; i < els.length && i < 20000; i++) { var cs = getComputedStyle(els[i]); out.push(cs.fill + "|" + cs.stroke + "|" + cs.color + "|" + cs.backgroundColor); }
      return out;
    }
    var scheme = g.container.style.colorScheme, here = paint(), recoloured = 0;
    g.container.style.colorScheme = scheme === "dark" ? "light" : "dark";
    var there = paint();
    g.container.style.colorScheme = scheme;
    for (var pi = 0; pi < here.length; pi++) if (here[pi] !== there[pi]) recoloured++;
    var drawnAs = backdrop && backdrop.v.s.shape && backdrop.v.s.shape.node && backdrop.v.s.shape.node.querySelector("rect, path") ?
      getComputedStyle(backdrop.v.s.shape.node.querySelector("rect, path")).fill : null;
    var fix = " Run the backdrop command on the file to fix this.";
    if (backdrop) {
      if (outside.length) add("warning", "outside-backdrop", outside.map(function (c) { return c.id; }),
        outside.length + (outside.length === 1 ? " item extends" : " items extend") + " beyond the background box \"" + backdrop.c.id + "\": " +
        outside.slice(0, 5).map(name).join(", ") + (outside.length > 5 ? " and " + (outside.length - 5) + " more" : "") +
        ". In a dark theme or a transparent export, that part has no white behind it." + fix);
      var weak = [];
      if (!backdrop.locked) weak.push("is an ordinary shape, so it gets selected and dragged by accident");
      if (recoloured || adaptive !== "none") weak.push((weak.length ? "it " : "") + "is recoloured by draw.io's dark theme along with what is on it" +
        (recoloured ? " (" + recoloured + " drawn elements change colour)" : "") + ", because the page does not turn adaptive colours off");
      if (weak.length) add("info", "background", [backdrop.c.id], "the background box \"" + backdrop.c.id + "\" " + weak.join(", and ") + "." + fix);
    } else if (cells.length) {
      add("info", "background", [], "this page has no white background box, so its colours follow the theme of whoever opens it" +
        (recoloured ? ": " + recoloured + " drawn elements (text, lines, fills) change colour in draw.io's dark theme" : "") +
        ". The backdrop command adds a locked white background and pins the colours.");
    }

    // Rendered positions back to the coordinates used in the file. The viewer may apply its offset in
    // the states or as a transform on the drawing, so the offset is read from a top-level shape.
    var b = g.getGraphBounds(), off = g.useCssTransforms ? { x: 0, y: 0 } : { x: view.translate.x, y: view.translate.y };
    for (var q = 0; q < solid.length; q++) {
      var geo0 = m.getGeometry(solid[q].c);
      if (geo0 && !geo0.relative && m.getParent(solid[q].c) === layerOf(solid[q].c)) { off = { x: solid[q].r.x - geo0.x, y: solid[q].r.y - geo0.y }; break; }
    }
    function model(r) { return r ? { x: Math.round((r.x - off.x) * 100) / 100, y: Math.round((r.y - off.y) * 100) / 100, w: Math.round(r.w * 100) / 100, h: Math.round(r.h * 100) / 100 } : null; }
    return { cells: cells.length - (backdrop ? 1 : 0), shapes: V.length - (backdrop ? 1 : 0), edges: E.length, crossings: crossings, scale: view.scale,
      bounds: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      content: ext ? model({ x: ext.x, y: ext.y, w: ext.x2 - ext.x, h: ext.y2 - ext.y }) : null,
      background: { id: backdrop ? backdrop.c.id : null, locked: backdrop ? backdrop.locked : false, rect: backdrop ? model(backdrop.r) : null,
        fill: backdrop ? String(backdrop.v.st.fillColor == null ? "default" : backdrop.v.st.fillColor) : null,
        drawnAs: drawnAs, recoloured: recoloured, adaptiveColors: adaptive, pageColor: g.background || null },
      findings: findings, images: images, blocked: (window.__blocked || []).slice() };
  }

  window.drawioArch = { load: load, pageCount: function () { return pageNames().length; }, pageNames: pageNames, selectPage: selectPage, inspect: inspect, setScale: setScale, clip: clip };

  // Manual viewing (the `serve` command): the token is in the URL fragment.
  if (location.hash.length > 1) {
    load(location.hash.slice(1)).catch(function (e) { document.getElementById("message").textContent = "Could not render: " + e.message; });
  }
})();

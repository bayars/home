# Editing .drawio XML by hand

Use this when changing an existing file. For a new diagram, write a spec instead: the build step gets all of this right for you.

Contents: [File structure](#file-structure) · [Page properties](#page-properties) · [Layers and the white background](#layers-and-the-white-background) · [The rules that break files](#the-rules-that-break-files) · [Shapes](#shapes) · [Containers](#containers) · [Edges](#edges) · [Labels](#labels) · [Common edits](#common-edits) · [After every edit](#after-every-edit)

## File structure

```xml
<mxfile>
  <diagram id="page-1" name="Page name">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- shapes and edges, each an mxCell with parent="1" or parent="<container id>" -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

One `<diagram>` per page. Cells `0` and `1` are required on every page; cell `0` may be wrapped in an `<object>` that holds the page's description (see [Page properties](#page-properties)). A page whose `<diagram>` contains a long base64 string instead of `<mxGraphModel>` is compressed: run `decompress` first.

Some files wrap a cell in `<object>` or `<UserObject>` to carry extra properties. Then the id and the label are on the wrapper (`<object id="x" label="..."><mxCell .../></object>`), not on the `mxCell`.

Find your way around with `outline file.drawio`, then search the XML for the ids it prints.

## Page properties

A page can say what it shows. The text lives on the root cell, which draw.io then writes as an `<object>` wrapped around it, with the id on the wrapper:

```xml
<root>
  <object label="" description="Production deployment of the orders platform ..." id="0">
    <mxCell/>
  </object>
  <mxCell id="1" parent="0"/>
```

Nothing in it is drawn. draw.io keeps it when it saves, and shows it under Edit > Edit Data when nothing is selected. `scan`, `describe` and `outline` print it.

- **Read it before you edit**, to know what the diagram is meant to show: `describe file.drawio`.
- **Change it with `describe file.drawio --set "..." -o file.drawio`**, not by typing into the XML. The command takes care of the wrapper and of escaping (a line break in an attribute has to be written `&#xa;`). Do this whenever your edit changes what the diagram shows, and when the page had no description.
- A file built by this skill has three more properties there: `generator`, `spec` and `fingerprint`. Leave them as they are. Once you edit the XML, the fingerprint no longer matches the drawing; that is intended, and is how later runs know that this diagram now has manual changes and must not be rebuilt from its spec.
- Other properties are someone else's (`owner`, `link`, anything). Keep them.
- Never give another cell `id="0"`, and never delete the wrapper: the root cell is inside it.

## Layers and the white background

Cells whose parent is `0` are layers, drawn in file order: the first is at the back. A file built by this skill has two.

```xml
<mxGraphModel ... adaptiveColors="none" background="#ffffff">
  <root>
    <mxCell id="0"/>
    <mxCell id="background_layer" value="Background" style="locked=1;" parent="0"/>
    <mxCell id="backdrop" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=none;" vertex="1" parent="background_layer">
      <mxGeometry x="0" y="0" width="1847" height="856" as="geometry"/>
    </mxCell>
    <mxCell id="1" value="Diagram" parent="0"/>
    ...
```

- `backdrop` is the white box everything sits on. Its layer is locked (`locked=1`), so in draw.io it cannot be selected, moved or deleted by accident, and a click on it counts as a click on the empty canvas.
- `adaptiveColors="none"` stops draw.io's dark theme recolouring the page. Without it the dark theme inverts the white box along with everything else, which is why a box alone is not enough.
- `background="#ffffff"` makes the canvas around the box white too.

When editing:

- **Put new shapes and edges in the drawing layer**, the one `outline` names after "New shapes go in". That is `1` in almost every file. Never use the background layer as a parent.
- **Do not edit the box or the layer by hand.** After your edit, `backdrop file.drawio -o file.drawio` resizes the box from the rendered page, labels and edge routes included. Typed coordinates will be wrong as soon as a label is wider than you guessed.
- **A file from elsewhere may have neither.** The same command adds them. If the user had drawn their own white box behind the diagram, it is moved into a new locked layer and kept, not duplicated.
- The command grows a box but does not shrink one unless you pass `--fit`, because people size a background on purpose (to match a slide, for example). `--margin N` sets the space around the content (default 20).
- Other files use extra layers for their own reasons. Keep each cell in the layer it was in.

## The rules that break files

1. **Ids are unique within a page.** Before adding a cell, check the outline for the id. A duplicate silently replaces or renumbers a cell. `backdrop` and `background_layer` are taken in files built by this skill.
2. **Coordinates are relative to the parent.** A child of a container at `x="20" y="40"` is 20 right and 40 down from the container's top-left corner, not from the page.
3. **An edge belongs to the innermost container that holds both its ends.** Both ends in the same subnet: `parent` is that subnet. Ends in different containers: `parent` is the container that encloses both, or `1` if none does. An end that is itself a container counts as holding its own contents.
4. **Every edge has a geometry child.** `<mxCell ... edge="1" .../>` (self-closing) is never drawn. Write `<mxCell ... edge="1" ...><mxGeometry relative="1" as="geometry"/></mxCell>`.
5. **Attribute values are XML-escaped.** `&` is `&amp;`, `<` is `&lt;`, `>` is `&gt;`, `"` is `&quot;`. This applies twice for HTML labels: a bold label is `value="&lt;b&gt;Title&lt;/b&gt;"`.
6. **Style strings are exact.** `key=value;key=value;`. Keys are case-sensitive (`whiteSpace`, not `whitespace`). Never invent a `shape=` or `resIcon=` name.
7. **No XML comments in the output.** draw.io's own guidance is to leave them out, and a `--` inside a comment makes the whole file invalid. (The comment in the structure example above is only there to explain it.)

## Shapes

```xml
<mxCell id="orders" value="Order service" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="200" y="120" width="140" height="60" as="geometry"/>
</mxCell>
```

For a vendor icon, get the style and the default size from the catalogue, and copy the style exactly:

```
node SKILL_DIR/scripts/drawio-arch.mjs icons lambda --provider aws --style
aws.lambda                                   Lambda
    78x78  sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=#ED7100;...;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;
```

Scale the size as you like but keep the width-to-height ratio; 48 px on the longer side matches diagrams built by this skill. Icon labels sit below the icon, so leave about 30 px under it.

Match the file you are editing: reuse the style of a neighbouring shape of the same type rather than introducing a new look.

## Containers

A container is a shape with `container=1;` in its style (or the `swimlane` style) and children whose `parent` is its id.

```xml
<mxCell id="vpc" value="VPC" style="rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;fillColor=none;container=1;collapsible=0;pointerEvents=0;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="400" height="240" as="geometry"/>
</mxCell>
<mxCell id="web" value="web" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="vpc">
  <mxGeometry x="30" y="50" width="120" height="60" as="geometry"/>
</mxCell>
```

- Keep every child inside the parent: `x + width` no more than the parent's width, `y + height` no more than its height, and `y` at least 30 so the title stays visible.
- When you add a child, enlarge the container (and its own ancestors) if needed. Then check that the enlarged container does not run into its neighbours.
- To move a shape into a container: set `parent` to the container's id **and** subtract the container's absolute position from the shape's `x` and `y`. To move it out, do the reverse.
- The boundary styles used by this skill are in `assets/kinds.json` under `groups` (field `s`).

## Edges

```xml
<mxCell id="e_web_db" value="SQL" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;" edge="1" source="web" target="db" parent="vpc">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

- With no waypoints draw.io routes a simple right-angle path that ignores other shapes. If `check` then reports `edge-through-node`, add waypoints in the edge's parent's coordinate system:
  ```xml
  <mxGeometry relative="1" as="geometry">
    <Array as="points"><mxPoint x="300" y="80"/><mxPoint x="300" y="220"/></Array>
  </mxGeometry>
  ```
- `exitX`/`exitY` and `entryX`/`entryY` (0 to 1) in the style fix where the edge leaves and arrives: `exitX=1;exitY=0.5;` is the middle of the right side.
- Diagrams built by this skill give every edge explicit waypoints and exit and entry points. If you move a shape in such a file, delete the `<Array as="points">` and the `exit*`/`entry*` style keys of its edges and let draw.io reroute, or rebuild from the spec, which is cleaner.
- Arrow styles: `endArrow=block;endFill=1;` (default here), `endArrow=none;`, `startArrow=block;startFill=1;` for both ends, `dashed=1;dashPattern=6 4;`.

## Labels

- Put `html=1;` in every style. Then `<br>`, `<b>`, `<i>` work (escaped in the attribute), and plain text is unaffected.
- Line break: `&lt;br&gt;` with `html=1`, or `&#xa;` in any label. Never a literal `\n`.
- Long text inside a box needs `whiteSpace=wrap;` and a box large enough for the wrapped lines.
- Edge labels: one to three words.

## Common edits

**Add a node to a container.** Pick a free id. Copy a sibling's style. Place it relative to the container, clear of siblings by at least 30 px and of their labels. Enlarge the container if it does not fit. Add its edges with the right `parent` (rule 3).

**Rename.** Change `value` (or `label` on an `<object>` wrapper). If the new text is longer, widen the shape or expect `label-overflow`.

**Delete a node.** Remove its cell, every edge whose `source` or `target` is its id, and every cell whose `parent` is its id.

**Recolour.** Change `fillColor`, `strokeColor`, `fontColor` in the style. Keep the rest.

**Replace an icon.** Swap only the style (from `icons --style`); keep id, geometry and edges.

**Large restructuring.** If more than about a third of the diagram moves, ask the user whether to rebuild it from a spec instead. That gives a clean layout but discards their manual placement.

**Colours and the theme.** With `adaptiveColors="none"` every colour is drawn as written, so write explicit ones (`fontColor=#1a1a1a`, `strokeColor=#4D4D4D`) and give edge labels `labelBackgroundColor=#ffffff`. The value `default` means "whatever the theme uses" and is the usual reason a shape looks different on someone else's screen.

## After every edit

```
node SKILL_DIR/scripts/drawio-arch.mjs backdrop edited.drawio -o edited.drawio --check --png edited.png
```

This refits the white background to what is on the page now, then checks and renders the result. Use plain `check edited.drawio --png edited.png` instead only when the user wants the file left without a background. Add `--theme dark` to either command to see the file as a dark-theme draw.io shows it.

Then bring the description up to date if the edit changed what the diagram shows, or if `check` reports `no-description`:

```
node SKILL_DIR/scripts/drawio-arch.mjs describe edited.drawio --set "What the diagram shows now." -o edited.drawio
```

Compare with a check of the original file. Fix findings your edit introduced; report, but do not silently change, findings that were already there. Then look at the PNG.

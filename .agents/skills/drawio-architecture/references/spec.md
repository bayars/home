# Spec reference

A spec is one JSON object. It lists what exists (`nodes`), what contains what (`groups`) and what connects to what (`edges`). It never contains positions or sizes; the build step decides those.

Contents: [Top level](#top-level) · [Nodes](#nodes) · [Box kinds](#box-kinds) · [Groups](#groups) · [Group kinds](#group-kinds) · [Edges](#edges) · [Steering the layout](#steering-the-layout) · [The description](#the-description) · [Rules the build step enforces](#rules-the-build-step-enforces)

## Top level

| Field | Type | Default | Meaning |
|---|---|---|---|
| `title` | text | none | Heading drawn above the diagram; also the page name. |
| `description` | text, 20 to 2,000 characters | required | What the diagram shows and how the system works, in three to six plain sentences. Stored in the file and not drawn. See [The description](#the-description). |
| `direction` | `right`, `down`, `left`, `up` | `right` | The way the main flow runs. |
| `spacing` | `compact`, `normal`, `roomy` | `normal` | Gaps between shapes. |
| `iconSize` | number, 24 to 128 | 48 | Size of icons in pixels (longest side). |
| `background` | `white`, `none` | `white` | `white` puts the diagram on a white box in a locked layer and turns off draw.io's theme recolouring, so the file reads the same in a light or dark draw.io and exports on white. `none` leaves the page transparent and theme-following; `check` then adds a `background` note. |
| `nodes` | array | required | At least one. |
| `groups` | array | `[]` | Boundaries. |
| `edges` | array | `[]` | Connections. |

Any other top-level field is rejected, so a typo is reported instead of being ignored.

## Nodes

| Field | Meaning |
|---|---|
| `id` | Required. Starts with a letter; letters, digits, `_`, `.`, `-`; at most 64 characters. Unique across nodes and groups. Becomes the cell id in the `.drawio` file. |
| `label` | Text shown. Defaults to the id. Use `\n` for a line break. |
| `icon` | A catalogue key such as `aws.lambda`. Find keys with `drawio-arch.mjs icons <words>`. |
| `kind` | A box kind (table below). Used when there is no `icon`. Default `service`. |
| `parent` | Id of the group this node is inside. |
| `tech` | Box kinds only. Shown in brackets under the label: `[Go]`. |
| `desc` | Box kinds only. One or two sentences shown under the label. |
| `color` | Box kinds only. One of `blue`, `green`, `yellow`, `orange`, `red`, `purple`, `grey`, `white`. |
| `size` | Icons only. Overrides `iconSize` for this node (16 to 200). |

Give `icon` or `kind`, not both. Icon labels sit below the icon when the diagram flows sideways and beside it when the diagram flows up or down, so edges never run through them.

Icon key prefixes: `aws.` (AWS service squares, plus resource glyphs; when both exist the glyph is `<name>_glyph`), `azure.`, `gcp.` (hexagon product icons), `k8s.`, `cisco.`, `net.` (generic network gear). Some short aliases exist (`aws.alb`, `aws.kms`, `azure.aks`, `gcp.gke`, `k8s.deployment`); the search shows them in brackets.

## Box kinds

| Kind | Looks like | Use for |
|---|---|---|
| `service` | Blue rounded box | A service, application or component. The default. |
| `client` | Green rounded box | A front end: web app, mobile app, CLI. |
| `external` | Grey dashed box | A system outside your control: third-party API, partner, SaaS. |
| `database` | Cylinder | A database or other data store. |
| `queue` | Horizontal cylinder | A queue, topic or stream. |
| `document` | Page with a wavy edge | A file, report or stored object. |
| `cloud` | Cloud | The internet or an unspecified network. |
| `actor` | Stick figure, label outside | A person or user role. |
| `note` | Yellow sticky note | A comment or a legend. Usually left unconnected. |
| `text` | Plain text | A caption with no border. |
| `c4.person` | Dark blue person | C4 person. |
| `c4.system` | Dark blue box | C4 software system in scope. |
| `c4.external` | Grey box | C4 external system. |
| `c4.container` | Mid blue box | C4 container. |
| `c4.component` | Light blue box | C4 component. |
| `c4.database` | Mid blue cylinder | C4 container that is a database. |

C4 kinds add the type line for you: a `c4.container` with `"tech": "Java"` shows `[Container: Java]`.

## Groups

| Field | Meaning |
|---|---|
| `id` | Required. Same rules as a node id. |
| `label` | Title shown at the top of the boundary. Keep it on one line. |
| `kind` | A group kind (table below). Default `group`. |
| `parent` | Id of the enclosing group. Nest as deep as the real structure goes. |
| `color` | Recolours the boundary: same names as for boxes. |
| `parallel` | `true` or `false`. Overrides the kind's default; see [Steering the layout](#steering-the-layout). |

A group must contain at least one node or group to be useful; an empty one is drawn as an empty box and reported as a note.

## Group kinds

| Kind | Looks like | Parallel by default |
|---|---|---|
| `group` | Light grey box, bold title | no |
| `boundary` | Dashed outline, no fill | no |
| `c4.boundary` | Dashed outline (C4 system or container boundary) | no |
| `aws.cloud` | AWS Cloud border with logo | no |
| `aws.account` | AWS account border | no |
| `aws.region` | Dashed teal border with flag | yes |
| `aws.vpc` | Purple VPC border | no |
| `aws.az` | Dashed blue border, centred title | yes |
| `aws.subnet_public` | Green filled subnet | no |
| `aws.subnet_private` | Teal filled subnet | no |
| `aws.security_group` | Red outline, centred title | no |
| `aws.asg` | Dashed orange Auto Scaling group | no |
| `aws.datacenter` | Corporate data center border | no |
| `aws.ec2_instance` | Contents of one EC2 instance | no |
| `aws.step_functions_workflow` | Step Functions workflow border | no |
| `azure.subscription` | Blue outline | no |
| `azure.region` | Grey dashed outline | yes |
| `azure.az` | Blue dashed outline, centred title | yes |
| `azure.resource_group` | Grey dashed outline | no |
| `azure.vnet` | Blue dashed outline, light fill | no |
| `azure.subnet` | Dotted blue outline | no |
| `gcp.project` | Light grey fill | no |
| `gcp.region` | Blue-grey fill | yes |
| `gcp.zone` | Cream fill | yes |
| `gcp.vpc` | Light blue fill | no |
| `gcp.subnet` | Light purple fill | no |
| `k8s.cluster` | Thick blue outline | no |
| `k8s.namespace` | Dashed blue outline | no |
| `k8s.node` | Grey outline | no |

`drawio-arch.mjs kinds` prints the same list from the installed version.

## Edges

| Field | Meaning |
|---|---|
| `from`, `to` | Required. Ids of nodes or groups. They must differ. |
| `label` | One to three words. `\n` for a line break. |
| `dashed` | `true` for a dashed line. Pick one meaning (asynchronous, optional, replication) and keep to it. |
| `both` | `true` for arrowheads at both ends. |
| `arrow` | `"none"` for a plain line (physical links in a network diagram). Default is an arrowhead at `to`. |
| `color` | Line colour: same names as for boxes. |
| `layout` | `false` keeps this edge out of the layout; see below. `true` forces it in. |
| `id` | Optional cell id. Otherwise `e1`, `e2`, ... in order. |

An edge to a group ends at the group's border. Prefer connecting to a node inside it when you mean that node.

## Steering the layout

The layout arranges nodes in layers along `direction`, following the edges. Two hints change what it does. Use them only when the picture needs it.

**`parallel` groups.** Availability zones and regions are copies of the same thing and should sit side by side, across the flow. An edge between two of them (replication, failover, a call from one zone's app to the other zone's database) would otherwise force one zone *behind* the other. So when an edge runs between two sibling groups that are both parallel, it is left out of the layout and routed afterwards through the free space. Zone and region kinds are parallel by default. Set `"parallel": true` on other sibling groups that are replicas (two clusters, blue and green stacks), or `"parallel": false` on a zone kind you are using as an ordinary stage.

**`"layout": false` on an edge.** The same treatment for one edge. Use it for an edge that goes against the main flow and drags the picture out of shape: a callback, a feedback loop, monitoring that reads from everything, an event that returns to an earlier stage. Signs you need it: a node placed far from where it belongs, or a diagram that became twice as long after one edge was added.

Other levers, in the order to try them:

1. Reorder the spec. Order of declaration decides ties.
2. Switch `direction`. Deep nesting usually reads better `right`; hub-and-spoke and trees read better `down`.
3. Move a node to the group it really belongs to. A node outside its boundary pulls edges across it.
4. `spacing: "compact"` for a diagram that is clean but too large; `"roomy"` when edge labels crowd.
5. Split the diagram.

Diagrams with no groups at all are packed into a block, so unconnected parts do not line up in one long row.

## The description

The description is how a diagram is found again. `scan` prints it for every diagram in a folder, and that is what decides whether a later request updates this diagram or draws a new one. Write it for a reader who has not seen the picture:

1. **Which system and which view.** "Production deployment of the orders platform on AWS", not "Architecture". Use the name the user uses for the system.
2. **How it works, in order.** Follow a request or a piece of data from where it enters to where it ends up, naming the components it passes.
3. **Boundaries and redundancy.** Regions, zones, networks, clusters, trust zones; what exists twice and how the copies relate.
4. **What is left out**, when a reader might expect it: "monitoring is not shown", "only zone a is drawn".

Plain sentences, no markup. Line breaks are kept. Leave out credentials, tokens, connection strings and anything else that should not be read by everyone who can open the file. Seven examples of the length and level to aim for are in `examples/`.

Change the description whenever a change to the spec changes what the diagram shows.

The build stores three more things beside it in the page, none of them drawn: the spec itself (so `spec <file> -o <out.json>` can give it back), a marker that this skill built the page, and a fingerprint of the drawing. The fingerprint is how `scan`, `spec` and `build` know whether someone has rearranged the diagram by hand since, in which case it must be edited as XML instead of rebuilt. In draw.io all four appear under Edit > Edit Data with nothing selected.

## Rules the build step enforces

The build step stops with a list of every problem it found, so fix them all before running again:

- a missing, very short (under 20 characters) or very long (over 2,000) `description`
- unknown fields (at any level), unknown icon keys (with suggestions), unknown kinds, unknown colours
- duplicate ids, ids that do not match the pattern, and the three ids the build uses itself: `diagram_title`, `backdrop`, `background_layer`
- a `parent` that does not exist, is a node, or forms a loop
- an edge whose `from` or `to` is not an id, or that connects a thing to itself
- `icon` and `kind` together; `tech` or `desc` on an icon node

Labels are plain text. Characters such as `<`, `&` and quotes are escaped for you, so write them as they are.

`build` also refuses to write over an existing `.drawio` file that was drawn by hand, made with another tool, or rearranged by hand after it was built, because that would replace someone's layout. Such a file is changed by editing its XML. `--overwrite` replaces it anyway.

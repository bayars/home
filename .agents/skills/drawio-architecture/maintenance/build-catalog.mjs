#!/usr/bin/env node
// Regenerates assets/icons.json: short icon keys -> exact draw.io style strings.
//
// Maintainers only (see docs/MAINTENANCE.md). Inputs are two local checkouts:
//   1. https://github.com/jgraph/drawio      at the pinned release tag
//   2. https://github.com/jgraph/drawio-mcp  (for shape-search/search-index.json)
//
//   node maintenance/build-catalog.mjs /path/to/drawio /path/to/drawio-mcp
//
// Reads files only. Every entry is checked against the pinned draw.io files:
// an icon whose stencil or image is not in that release is left out.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.length < 4) { console.error("usage: build-catalog.mjs <drawio-checkout> <drawio-mcp-checkout>"); process.exit(2); }
const drawio = resolve(process.argv[2]), mcp = resolve(process.argv[3]);
const web = join(drawio, "src/main/webapp");
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "../assets/drawio-manifest.json"), "utf8"));
const index = JSON.parse(readFileSync(join(mcp, "shape-search/search-index.json"), "utf8"));
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

// ---- what exists in the pinned release -------------------------------------
const stencils = new Set();
const stencilFile = f => {
  const xml = readFileSync(join(web, "stencils", f), "utf8");
  const pkg = (/<shapes[^>]*\bname="([^"]+)"/.exec(xml) || [])[1];
  if (!pkg) return;
  for (const m of xml.matchAll(/<shape\b[^>]*\bname="([^"]+)"/g)) stencils.add((pkg + "." + m[1].replace(/ /g, "_")).toLowerCase());
};
for (const f of ["aws4.xml", "gcp2.xml", "kubernetes.xml", "kubernetes2.xml", "cisco19.xml", "networks.xml"]) stencilFile(f);
const jsShapes = new Set();
for (const f of readdirSync(join(web, "shapes")).filter(f => f.endsWith(".js")))
  for (const m of readFileSync(join(web, "shapes", f), "utf8").matchAll(/'(mxgraph\.[A-Za-z0-9_.]+)'/g)) jsShapes.add(m[1]);
const hasStencil = n => stencils.has(String(n).toLowerCase());
const hasShape = n => hasStencil(n) || jsShapes.has(n);

// ---- helpers ----------------------------------------------------------------
const san = s => s.toLowerCase().replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const get = (style, key) => (new RegExp("(?:^|;)" + key + "=([^;]*)").exec(style) || [])[1];
const BOILER = new Set("aws4 aws amazon web service services azure2 azure microsoft gcp gcp2 google cloud platform kubernetes cisco19 cisco networks network mxgraph icon icons the and for of".split(" "));
const tagsOf = (e, key) => {
  const inKey = new Set(key.split(/[._]/));
  const seen = new Set();
  for (const t of (e.tags || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/))
    if (t.length > 1 && !BOILER.has(t) && !inKey.has(t)) seen.add(t);
  return [...seen].slice(0, 8).join(" ");
};
const icons = {};
const dropped = {};
const add = (key, title, style, w, h, tags) => {
  if (icons[key]) return false;
  icons[key] = { t: title.replace(/\s+/g, " ").trim(), w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, s: style.endsWith(";") ? style : style + ";", ...(tags ? { g: tags } : {}) };
  return true;
};
const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
const vertices = index.filter(e => e.type === "vertex" && typeof e.style === "string" && !/image=data:/.test(e.style));

// ---- AWS: service icons (coloured squares), then resource glyphs ------------
for (const e of vertices) {
  if (get(e.style, "shape") !== "mxgraph.aws4.resourceIcon") continue;
  const res = get(e.style, "resIcon") || "";
  if (!res.startsWith("mxgraph.aws4.")) continue;
  if (!hasStencil(res)) { drop("aws stencil missing"); continue; }
  const key = "aws." + res.slice("mxgraph.aws4.".length);
  add(key, e.title, e.style, e.w, e.h, tagsOf(e, key));
}
for (const e of vertices) {
  const shape = get(e.style, "shape") || "";
  if (!shape.startsWith("mxgraph.aws4.") || /\.(resourceIcon|productIcon|group|groupCenter|group2)$/.test(shape)) continue;
  if (!hasShape(shape)) { drop("aws shape missing"); continue; }
  const name = shape.slice("mxgraph.aws4.".length);
  const key = icons["aws." + name] ? "aws." + name + "_glyph" : "aws." + name;
  add(key, e.title, e.style, e.w, e.h, tagsOf(e, key));
}

// ---- Azure: SVG images shipped with draw.io ---------------------------------
for (const e of vertices) {
  const img = get(e.style, "image") || "";
  if (!img.startsWith("img/lib/azure2/")) continue;
  if (!manifest.files[img]) { drop("azure image missing"); continue; }
  const key = "azure." + san(img.split("/").pop().replace(/\.svg$/i, ""));
  add(key, e.title, e.style, e.w, e.h, tagsOf(e, key));
}

// ---- GCP: hexagon product icons built from the gcp2 stencil set --------------
// The official index omits most of these, so they are generated from the stencil file itself.
{
  const xml = readFileSync(join(web, "stencils/gcp2.xml"), "utf8");
  const HEX = "sketch=0;html=1;fillColor=#5184F3;strokeColor=none;verticalAlign=top;labelPosition=center;verticalLabelPosition=bottom;align=center;fontSize=12;fontStyle=0;fontColor=#3C4043;shape=mxgraph.gcp2.hexIcon;prIcon=";
  if (!jsShapes.has("mxgraph.gcp2.hexIcon")) throw new Error("mxgraph.gcp2.hexIcon is not in this draw.io release");
  for (const m of xml.matchAll(/<shape\b[^>]*\bname="([^"]+)"/g)) {
    const pr = m[1].replace(/ /g, "_").toLowerCase();
    if (/^(outline_|blank$|blue_hexagon$|placeholder$)/.test(pr)) continue;
    add("gcp." + san(m[1]), m[1], HEX + pr, 66, 58.5, "");
  }
}

// ---- Kubernetes ---------------------------------------------------------------
for (const e of vertices) {
  if (get(e.style, "shape") !== "mxgraph.kubernetes.icon2") continue;
  const pr = get(e.style, "prIcon");
  if (!pr || !hasStencil("mxgraph.kubernetes2." + pr)) { drop("k8s stencil missing"); continue; }
  add("k8s." + san(pr), e.title, e.style, e.w, e.h, tagsOf(e, "k8s." + pr));
}

// ---- Network equipment: Cisco (2019 set) and generic --------------------------
for (const e of vertices) {
  const shape = get(e.style, "shape") || "";
  if (!shape.startsWith("mxgraph.cisco19.")) continue;
  const pr = get(e.style, "prIcon");
  const ok = pr ? hasStencil("mxgraph.cisco19." + pr) && hasShape(shape) : hasShape(shape);
  if (!ok) { drop("cisco stencil missing"); continue; }
  const key = "cisco." + san(pr || shape.slice("mxgraph.cisco19.".length));
  add(key, e.title, e.style, e.w, e.h, tagsOf(e, key));
}
for (const e of vertices) {
  const shape = get(e.style, "shape") || "";
  if (!shape.startsWith("mxgraph.networks.") || /perimeter=backbonePerimeter|_edge$/.test(e.style + shape)) continue;
  if (!hasStencil(shape)) { drop("networks stencil missing"); continue; }
  const key = "net." + san(shape.slice("mxgraph.networks.".length));
  add(key, e.title, e.style, e.w, e.h, tagsOf(e, key));
}

// ---- friendly aliases (kept only when the target exists) ------------------------
const wanted = {
  "aws.alb": "aws.application_load_balancer", "aws.nlb": "aws.network_load_balancer", "aws.elb": "aws.elastic_load_balancing",
  "aws.igw": "aws.internet_gateway", "aws.apigw": "aws.api_gateway", "aws.ddb": "aws.dynamodb", "aws.route53": "aws.route_53",
  "aws.cloudwatch": "aws.cloudwatch_2", "aws.kinesis_streams": "aws.kinesis_data_streams", "aws.msk": "aws.managed_streaming_for_kafka",
  "aws.opensearch": "aws.elasticsearch_service", "aws.opensearch_service": "aws.elasticsearch_service", "aws.kms": "aws.key_management_service",
  "aws.iam": "aws.identity_and_access_management", "aws.efs": "aws.elastic_file_system", "aws.ses": "aws.simple_email_service",
  "aws.acm": "aws.certificate_manager", "aws.ssm": "aws.systems_manager", "aws.firehose": "aws.kinesis_data_firehose",
  "azure.cosmos_db": "azure.azure_cosmos_db", "azure.postgresql": "azure.azure_database_postgresql_server", "azure.mysql": "azure.azure_database_mysql_server",
  "azure.active_directory": "azure.azure_active_directory", "azure.firewall": "azure.firewalls", "azure.bastion": "azure.bastions",
  "azure.cdn": "azure.cdn_profiles", "azure.log_analytics": "azure.log_analytics_workspaces", "azure.vpn_gateway": "azure.virtual_network_gateways",
  "azure.dns": "azure.dns_zones", "azure.container_apps": "azure.container_app_environments",
  "azure.vm": "azure.virtual_machine", "azure.aks": "azure.kubernetes_services", "azure.app_service": "azure.app_services",
  "azure.functions": "azure.function_apps", "azure.storage": "azure.storage_accounts", "azure.vnet": "azure.virtual_networks",
  "azure.app_gateway": "azure.application_gateways", "azure.front_door": "azure.front_doors", "azure.key_vault": "azure.key_vaults",
  "azure.load_balancer": "azure.load_balancers", "azure.apim": "azure.api_management_services", "azure.sql": "azure.sql_database",
  "azure.redis": "azure.cache_redis", "azure.event_hub": "azure.event_hubs", "azure.container_registry": "azure.container_registries",
  "gcp.gke": "gcp.container_engine", "gcp.kubernetes_engine": "gcp.container_engine", "gcp.gce": "gcp.compute_engine", "gcp.gcs": "gcp.cloud_storage",
  "gcp.pubsub": "gcp.cloud_pubsub", "gcp.load_balancer": "gcp.cloud_load_balancing", "gcp.vpc": "gcp.virtual_private_cloud",
  "gcp.memorystore": "gcp.cloud_memorystore", "gcp.spanner": "gcp.cloud_spanner", "gcp.dataflow": "gcp.cloud_dataflow",
  "gcp.functions": "gcp.cloud_functions", "gcp.bigtable": "gcp.cloud_bigtable", "gcp.firestore": "gcp.cloud_firestore",
  "gcp.iam": "gcp.cloud_iam", "gcp.cdn": "gcp.cloud_cdn", "gcp.dns": "gcp.cloud_dns", "gcp.nat": "gcp.cloud_nat", "gcp.armor": "gcp.cloud_armor",
  "k8s.deployment": "k8s.deploy", "k8s.service": "k8s.svc", "k8s.ingress": "k8s.ing", "k8s.configmap": "k8s.cm", "k8s.statefulset": "k8s.sts",
  "k8s.daemonset": "k8s.ds", "k8s.namespace": "k8s.ns", "k8s.replicaset": "k8s.rs", "k8s.persistent_volume": "k8s.pv",
  "k8s.persistent_volume_claim": "k8s.pvc", "k8s.service_account": "k8s.sa", "k8s.network_policy": "k8s.netpol", "k8s.storage_class": "k8s.sc",
  "k8s.scheduler": "k8s.sched", "k8s.controller_manager": "k8s.c_m", "k8s.kube_proxy": "k8s.k_proxy", "k8s.volume": "k8s.vol",
};
const aliases = {};
const badAlias = [];
for (const [a, target] of Object.entries(wanted)) {
  if (icons[a]) continue;                       // a real icon already has this key
  if (icons[target]) aliases[a] = target; else badAlias.push(a + " -> " + target);
}

// ---- write -----------------------------------------------------------------------
const keys = Object.keys(icons).sort();
const body = keys.map(k => JSON.stringify(k) + ":" + JSON.stringify(icons[k])).join(",\n");
const head = {
  about: "Icon keys for the drawio-architecture skill. Each entry: t = title, w/h = draw.io's default size, s = draw.io style string, g = search tags. Generated by maintenance/build-catalog.mjs; do not edit by hand.",
  sources: {
    drawio: { repository: manifest.repository, version: manifest.version, commit: manifest.commit, license: "Apache-2.0" },
    "drawio-mcp": { repository: "https://github.com/jgraph/drawio-mcp", commit: git(mcp, "rev-parse", "HEAD"), file: "shape-search/search-index.json", license: "Apache-2.0" },
  },
};
const out = join(here, "../assets/icons.json");
writeFileSync(out, JSON.stringify(head).slice(0, -1) + ',\n"aliases":' + JSON.stringify(aliases) + ',\n"icons":{\n' + body + "\n}}\n");
const per = {};
for (const k of keys) per[k.split(".")[0]] = (per[k.split(".")[0]] || 0) + 1;
console.log(`${keys.length} icons ${JSON.stringify(per)}, ${Object.keys(aliases).length} aliases -> ${out}`);
if (Object.keys(dropped).length) console.log("left out:", JSON.stringify(dropped));
if (badAlias.length) console.log("aliases without a target (not written):", badAlias.join(", "));

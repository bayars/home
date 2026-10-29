---
name: fabric-builder
description: >-
  Design and generate FULL Nokia SR Linux / SR OS device configurations from
  parameters or natural-language intent — EVPN/VXLAN leaf-spine fabrics,
  SROS PE/core with VPRN/VPLS/epipe services, and day-0 base configs — in
  the exact artifact formats the device-configurator skill applies. Use
  whenever the user asks to design, build, or generate a fabric or any
  multi-device Nokia SRL/SROS configuration.
---

# Fabric Builder

Turns fabric intent into per-device config artifacts. Base directory:
`/root/poc/fabricBuilder`. Run all commands from there. Applying the
artifacts is the `device-configurator` skill's job
(`/root/poc/deviceConfigurator`).

## HARD RULES — read first

1. **Never free-hand the math.** For anything beyond a single device,
   write a `fabric.yml` spec and run `scripts/fabgen` — it does all
   IP//31/ASN/RD/RT/VNI allocation deterministically. Hand-edit generated
   artifacts only for knobs the generator doesn't cover
   (see `references/`).
2. **Keep the artifact contract** when editing: SRL day-2 files stay a
   JSON *list of `{path, value}` ops* (one commit); SRL day-0 stays flat
   `set /` commands; SROS stays one MD-CLI `configure { }` blob. Never an
   op with path `/`.
3. **Generation stops at files.** Present the summary and file paths, then
   stop — apply only when the user asks, and then strictly via `devconf`
   (`references/apply-recipe.md`), never line-by-line SSH.
4. Management (SRL `mgmt0`/`mgmt` NI, SROS `bof`) is containerlab-owned —
   never generate config for it.

## Scenarios

| `kind` | covers | artifacts per node |
|---|---|---|
| `srl-evpn-fabric` | SRL leaf-spine, eBGP underlay + iBGP EVPN overlay (spine RRs; `spines: 0` = leaf full-mesh), mac-vrf / ip-vrf (anycast IRB) over VXLAN | `<n>.cfg` (day-0) + `<n>.json` (day-2) |
| `sros-core` | SROS PE/P: ISIS/OSPF, LDP or SR-ISIS, iBGP vpn-ipv4/evpn (P = RR), VPRN / VPLS (EVPN-MPLS or SDP) / epipe | `<n>.partial.cfg` (day-0 and day-2) |
| `base-day0` | hostname, loopback, interfaces, protocol skeleton; mixed platforms | as above per platform |

Plus `topology.clab.yml`, `design.json`, `SUMMARY.md` per fabric.
Full parameter model + defaults + allocation rules:
`references/fabric-spec.md`. Ready-made specs: `examples/`.

## Workflow

1. **CLASSIFY** — pick the `kind` and the mode: lab not deployed → day-0
   path (clab topology + startup configs); nodes running → day-2 push
   artifacts. Ask only if the request is genuinely ambiguous.
2. **SPEC** — write `output/<name>/fabric.yml` from the user's parameters;
   omit anything the defaults already cover. `scripts/fabgen check --spec …`
   prints the fully resolved spec.
3. **GENERATE**
   ```bash
   scripts/fabgen plan  --spec output/<name>/fabric.yml   # allocation preview
   scripts/fabgen build --spec output/<name>/fabric.yml   # writes output/<name>/
   ```
   For non-trivial fabrics show the `plan` summary to the user before/with
   the build.
4. **AUGMENT** (only if needed) — hand-edit artifacts for uncovered knobs
   following `references/srl-evpn-vxlan.md` / `sros-services.md` /
   `day0-base.md`; re-run `devconf validate` after edits.
5. **DELIVER** — present `SUMMARY.md` and the file paths. **Stop.**
6. **APPLY (on request only)** — follow `references/apply-recipe.md`:
   day-0 `devconf deploy-lab`; day-2 per device
   `validate → backup → push → get`-verify, spines before leaves / P
   before PE, exit codes 2/3/4 handled as the recipe says.

## fabgen reference

```bash
scripts/fabgen check --spec fabric.yml      # validate + resolved defaults
scripts/fabgen plan  --spec fabric.yml [-o design.json]
scripts/fabgen build --spec fabric.yml [--out DIR] [--emit day0,day2,clab,summary]
# exit codes: 0 ok, 2 invalid spec (message names the key), 4 bad args
```

fabgen is a pure function of the spec — same spec, same artifacts. Fix
problems in the spec and rebuild rather than patching output when the knob
is covered.

## Status / environment

- SR Linux artifacts live-verified against `ghcr.io/nokia/srlinux:24.10.2`
  (lab `clab-srl-gw-test`; e2e: eBGP underlay + iBGP EVPN + mac-vrf VXLAN).
- SR OS artifacts are syntax/golden-verified only — no SROS image/license
  in this environment.
- Tests: `pytest` from the repo root (allocation invariants, artifact
  contract, golden content).

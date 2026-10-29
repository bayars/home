# fabric.yml — spec schema and allocation rules

One YAML file describes a whole fabric. `scripts/fabgen` turns it into
per-device config artifacts deterministically: **same spec in, same configs
out**, every IP/ASN/RD/RT predictable from the rules below. Everything is
optional except `kind`.

## Common fields (all kinds)

```yaml
kind: srl-evpn-fabric | sros-core | base-day0   # REQUIRED
name: fab1                # fabric name; also the clab lab name and output dir
emit: [day0, day2, clab, summary]   # default: all that apply to the kind
platform:
  srlinux:
    image: ghcr.io/nokia/srlinux:24.10.2
    type: ixrd2l
  sros:
    image: vrnetlab/nokia_sros:24.10
    license: /opt/nokia/sros.lic
```

`emit` values: `day0` (SRL `<node>.cfg` set-command file / SROS
`<node>.partial.cfg`), `day2` (SRL `<node>.json` `[{path,value}]` ops; for
SROS the `.partial.cfg` already serves day-2), `clab`
(`topology.clab.yml`), `summary` (`SUMMARY.md`). `design.json` is always
written.

Management (mgmt0 / BOF) is containerlab-owned and never configured.

---

## kind: srl-evpn-fabric

EVPN/VXLAN leaf-spine on SR Linux. Spines are underlay transit + overlay
route-reflectors (no VTEPs/services on spines).

```yaml
spines: 2                 # 0 allowed -> leaves only, explicit links required
leaves: 4
underlay: ebgp            # only ebgp implemented; isis reserved (phase 2)
asn:
  spine: 65100            # all spines share it
  leaf_base: 65001        # leafN = leaf_base + N - 1
overlay:
  type: ibgp-evpn         # only ibgp-evpn implemented
  asn: 65500              # overlay iBGP ASN (local-as on all overlay sessions)
addressing:
  loopbacks: 10.0.0.0/24  # /32s carved from here
  p2p: 10.100.0.0/16      # /31 per fabric link
uplink_port_base: 49      # leaf uplink to spineK = ethernet-1/(base+K-1)
vni_base: 10010           # service i (1-indexed): vni = vni_base + 10*(i-1)
evi_base: 1               # service i: evi = evi_base + i - 1
links: []                 # optional explicit links, replaces the default mesh:
                          #   - [leaf1:ethernet-1/1, leaf2:ethernet-1/1]
services: []              # default: one demo mac-vrf (see below)
```

### services

```yaml
services:
  - type: mac-vrf
    name: vlan10          # network-instance name
    vlan: 10              # access sub-if index and single-tagged vlan-id
    access_port: ethernet-1/10
    leaves: all           # or [leaf1, leaf2]
    vni: 10010            # default from vni_base rule
    evi: 1                # default from evi_base rule
  - type: ip-vrf
    name: tenant1
    attach: [vlan10]      # mac-vrf names to join via IRB
    gw: 172.16.10.1/24    # anycast-gw IRB address (per attached mac-vrf, one
                          # entry or list matching attach order)
    leaves: all
```

If `services` is omitted entirely, one demo service is generated:
`{type: mac-vrf, name: vlan10, vlan: 10, access_port: ethernet-1/10, leaves: all}`.

### Allocation rules (deterministic)

- Node names: `spine1..spineS`, `leaf1..leafL`.
- Loopbacks (= router-id = VTEP source, /32 on `system0.0`):
  spineK = loopbacks.base + K (10.0.0.**1**...), leafN = base + 10 + N
  (10.0.0.**11**...).
- Default links: every leaf to every spine. Order: leaf1's uplinks, then
  leaf2's, ... Each link takes the next /31 from `addressing.p2p`;
  **first-listed endpoint gets the lower (even) IP** — for default mesh
  links the endpoint order is (spine, leaf), so spines get the even IP.
- Default ports: leafN→spineK uses leaf port
  `ethernet-1/(uplink_port_base+K-1)` and spine port `ethernet-1/N`.
- Underlay eBGP: one session per link on the /31, `ipv4-unicast`, group
  `underlay`; loopback /32s exchanged via policy `underlay-loopbacks`
  (prefix-set = the loopbacks supernet, 32..32) applied as BOTH
  export-policy and import-policy (SR Linux eBGP is RFC 8212
  default-reject in each direction).
- Overlay iBGP EVPN (`local-as overlay.asn`, sessions between system0
  loopbacks, `transport local-address` = own loopback), group `overlay`:
  - spines > 0: every leaf peers with every spine loopback; spines are
    route-reflectors, `cluster-id` = spine1's loopback.
  - spines == 0: full mesh between leaf loopbacks (no RR).
- Per-leaf, per-service: RD = `<leaf-loopback>:<evi>`,
  RT = `target:<overlay.asn>:<evi>`, vxlan-interface = `vxlan1.<evi>`
  (type bridged for mac-vrf, routed for ip-vrf).
- clab endpoints: `ethernet-1/X` → `eX-Y` form (`ethernet-1/49` → `e1-49`).

---

## kind: sros-core

SR OS PE/P core: IGP + MPLS + iBGP VPN families, VPRN / VPLS / epipe
services. Artifacts are MD-CLI `<node>.partial.cfg` (day-0 startup and
day-2 `devconf push --platform sros`).

```yaml
pes: 2
ps: 0                     # P routers; first P is the iBGP RR when ps > 0
asn: 65000
igp: isis                 # or ospf
iso_area: "49.0001"       # isis only; system-id derives from system IP
mpls: ldp                 # or sr-isis (SRGB 19000..27999, node-SID index =
                          # last octet of loopback)
families: [vpn-ipv4]      # evpn auto-added if any service uses bgp-evpn
addressing:
  loopbacks: 10.10.10.0/24
  p2p: 10.101.0.0/16
links: []                 # optional explicit: - [pe1:1/1/3, pe2:1/1/3]
services: []
```

### services

```yaml
services:
  - type: vprn
    id: 100               # service-id; also RD/RT: <system-ip>:<id> /
    customer: 1           #   target:<asn>:<id>
    sites:
      - node: pe1
        port: 1/1/10      # SAP = <port>:<id>
        ip: 172.16.0.1/24 # VPRN interface address
  - type: vpls
    id: 200
    evpn: true            # true -> bgp-evpn mpls (adds evpn family);
    sites:                # false -> mesh-SDPs (LDP) between site nodes
      - {node: pe1, port: 1/1/11}
      - {node: pe2, port: 1/1/11}
  - type: epipe
    id: 300
    sites:                # exactly 2; same node = local, else spoke-SDP (LDP)
      - {node: pe1, port: 1/1/12}
      - {node: pe2, port: 1/1/12}
```

### Allocation rules

- Node names `pe1..`, `p1..`. Loopbacks (= system interface = router-id):
  pK = base + K (10.10.10.**1**...), peN = base + 10 + N (10.10.10.**11**...).
- Default links: ps == 0 → full mesh between PEs; ps > 0 → every PE to
  every P (no P-P links unless explicit). /31 per link from `p2p`,
  first endpoint gets the even IP; link order: pe1's links, pe2's, ...
- Default ports: next free `1/1/X` per node in link order. Every used port
  gets `ethernet { mode network }` + card 1 / MDA 1 day-0 skeleton.
- Router interfaces named `to-<peer>`; IGP + LDP (or SR) enabled on all of
  them, point-to-point.
- iBGP: ps == 0 → full mesh between PE system IPs; ps > 0 → p1 is RR
  (cluster-id = p1 system IP), everyone peers with p1 only. Group `ibgp`,
  the configured `families` on every session.
- SDP ids (non-EVPN vpls/epipe): `<service-id * 10 + remote-node-number>`,
  far-end = remote system IP, delivery ldp.

---

## kind: base-day0

Base/day-0 configs only: hostname, enabled interfaces, optional protocol
skeleton. No fabric math beyond loopbacks.

```yaml
nodes:
  - name: srl1
    platform: srlinux     # or sros
    interfaces: [ethernet-1/1]        # SROS: ["1/1/1"]
    protocol_skeleton: none           # none | bgp | isis | ospf (admin-enabled
    asn: 65001                        #   empty skeleton; asn for bgp)
    location: "built by fabricBuilder"
addressing:
  loopbacks: 10.0.0.0/24  # node i (spec order) gets base + i as system/loopback
links: []                 # optional, for the clab topology only
```

---

## Outputs (`fabgen build` → `output/<name>/`)

| file | kind | purpose |
|---|---|---|
| `<node>.cfg` | srlinux nodes | day-0 flat `set /` full config (deploy-lab startup) |
| `<node>.json` | srlinux nodes | day-2 `[{path,value}]` ops, same content as `.cfg` (one commit) |
| `<node>.partial.cfg` | sros nodes | MD-CLI blob, day-0 and day-2 |
| `topology.clab.yml` | all | containerlab topology (no startup-config entries; deploy-lab injects) |
| `design.json` | all | fully resolved design sheet (audit trail / re-render input) |
| `SUMMARY.md` | all | device / role / loopback / ASN / links / services table |

The `.cfg` and `.json` are generated from the same in-memory config tree —
they cannot diverge.

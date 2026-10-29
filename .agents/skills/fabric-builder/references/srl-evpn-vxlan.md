# SR Linux EVPN/VXLAN config reference (live-verified on 24.10.2)

Every structure below passed `devconf validate` against
`ghcr.io/nokia/srlinux:24.10.2` (clab-srl-gw-test, 2026-07-19). Use these
skeletons when hand-editing fabgen output for knobs the generator doesn't
cover. Keep the artifact contract: day-2 files stay a JSON **list of
`{path, value}` ops**; day-0 files stay flat `set /` commands.

## Schema gotchas (24.10.2)

- `export-policy` / `import-policy` under bgp group/neighbor are
  **leaf-lists**: `"export-policy": ["underlay-loopbacks"]` — a bare string
  is rejected ("no local leaf with the name 'export-policy'").
- **eBGP is RFC 8212 default-reject in BOTH directions**: without an
  explicit `import-policy` the peer's routes show up as
  "received … 0 used 0 valid" and nothing resolves; without
  `export-policy` nothing is advertised. Set both on eBGP groups.
- `local-as` is a container: `"local-as": {"as-number": 65500}`.
- Overlay session source: `"transport": {"local-address": "<loopback>"}`.
- Policy statement match: `"match": {"prefix-set": "loopbacks"}` (moves to
  `match/prefix/prefix-set` in later releases).
- `vxlan-interface` is keyed by **index** under `/tunnel-interface` but by
  **name** (`vxlan1.<idx>`) when referenced in a network-instance.
- Never touch `mgmt0` / network-instance `mgmt` — containerlab owns them.

## Fabric building blocks (JSON op form)

Loopback / VTEP source (advertised into the underlay, terminates VXLAN):

```json
{"path": "/interface[name=system0]",
 "value": {"admin-state": "enable", "subinterface": [{"index": 0,
   "admin-state": "enable", "ipv4": {"admin-state": "enable",
   "address": [{"ip-prefix": "10.0.0.11/32"}]}}]}}
```

Routed fabric p2p (same shape, `/31`), plus membership in
`/network-instance[name=default] interface <port>.0`.

Underlay routing policy (loopback /32s only; used as export AND import on
the eBGP underlay group — see the RFC 8212 gotcha above):

```json
{"path": "/routing-policy", "value": {
  "prefix-set": [{"name": "loopbacks",
    "prefix": [{"ip-prefix": "10.0.0.0/24", "mask-length-range": "32..32"}]}],
  "policy": [{"name": "underlay-loopbacks", "statement": [{"name": "10",
    "match": {"prefix-set": "loopbacks"},
    "action": {"policy-result": "accept"}}]}]}}
```

BGP: eBGP `underlay` group (ipv4-unicast on the /31s) + iBGP `overlay`
group (evpn between loopbacks, shared overlay ASN via `local-as`); spines
add `"route-reflector": {"client": true, "cluster-id": "<spine1-loopback>"}`
to the overlay group. Both `afi-safi` lists must exist at bgp level AND be
enabled per group.

Bridged access sub-interface (mac-vrf SAP):

```json
{"path": "/interface[name=ethernet-1/10]",
 "value": {"admin-state": "enable", "vlan-tagging": true,
   "subinterface": [{"index": 10, "type": "bridged", "admin-state": "enable",
     "vlan": {"encap": {"single-tagged": {"vlan-id": 10}}}}]}}
```

VXLAN tunnel endpoints (`type` bridged for mac-vrf, routed for ip-vrf):

```json
{"path": "/tunnel-interface[name=vxlan1]",
 "value": {"vxlan-interface": [
   {"index": 1, "type": "bridged", "ingress": {"vni": 10010}},
   {"index": 3, "type": "routed",  "ingress": {"vni": 10030}}]}}
```

mac-vrf service:

```json
{"path": "/network-instance[name=vlan10]",
 "value": {"type": "mac-vrf", "admin-state": "enable",
   "interface": [{"name": "ethernet-1/10.10"}, {"name": "irb0.10"}],
   "vxlan-interface": [{"name": "vxlan1.1"}],
   "protocols": {
     "bgp-evpn": {"bgp-instance": [{"id": 1, "admin-state": "enable",
       "vxlan-interface": "vxlan1.1", "evi": 1}]},
     "bgp-vpn": {"bgp-instance": [{"id": 1,
       "route-distinguisher": {"rd": "10.0.0.11:1"},
       "route-target": {"export-rt": "target:65500:1",
                        "import-rt": "target:65500:1"}}]}}}}
```

ip-vrf + anycast IRB (attach a mac-vrf by adding its `irb0.<vlan>` to both
network-instances):

```json
{"path": "/interface[name=irb0]",
 "value": {"subinterface": [{"index": 10, "admin-state": "enable",
   "anycast-gw": {"virtual-router-id": 1},
   "ipv4": {"admin-state": "enable",
     "address": [{"ip-prefix": "172.16.10.1/24", "anycast-gw": true}]}}]}}
```

```json
{"path": "/network-instance[name=tenant1]",
 "value": {"type": "ip-vrf", "admin-state": "enable",
   "interface": [{"name": "irb0.10"}],
   "vxlan-interface": [{"name": "vxlan1.3"}],
   "protocols": {"bgp-evpn": {...}, "bgp-vpn": {...}}}}
```

## Verification state paths (gNMI, `--datastore state`)

```
/network-instance[name=default]/protocols/bgp/neighbor[peer-address=X]/session-state
/network-instance[name=default]/protocols/bgp/neighbor[peer-address=X]/afi-safi[afi-safi-name=evpn]/active
/tunnel-interface[name=vxlan1]
/network-instance[name=vlan10]/oper-state
/network-instance[name=vlan10]/bridge-table
```

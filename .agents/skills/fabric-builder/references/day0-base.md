# Day-0 base config reference

`kind: base-day0` emits the minimal safe baseline per node: location,
loopback (`system0` / `"system"`), admin-enabled interfaces, and an
optional routing-protocol skeleton. Rules that always apply:

- **Management is containerlab-owned.** Never emit `mgmt0`, the `mgmt`
  network-instance (SRL), or `bof` (SROS). Users/AAA defaults
  (`admin:NokiaSrl1!` / `admin:admin`) come from the NOS defaults and
  clab — don't manage users unless explicitly asked.
- SRL day-0 artifacts are flat `set /` files; the same config also exists
  as `<node>.json` for day-2 push onto an already-running node.
- SROS day-0 = `<node>.partial.cfg` ("partial" in the name → merged onto
  defaults at boot).

## Protocol skeletons

| skeleton | SR Linux | SR OS |
|---|---|---|
| `bgp` | bgp admin-enable + AS + router-id + ipv4-unicast afi | `bgp { admin-state enable }` under router Base |
| `isis` | instance `default`, level L2, NET derived from loopback (`49.0001.<padded-ip>.00`) | `isis 0` + area-address |
| `ospf` | instance `default`, ospf-v2, router-id, area 0.0.0.0 | `ospf 0` + area 0.0.0.0 |

NET derivation from loopback 10.0.0.11:
pad octets to 3 digits (`010.000.000.011`) → regroup in 4s
(`0100.0000.0011`) → `49.0001.0100.0000.0011.00`.

## Deploying

Day-0 is `devconf deploy-lab` (from /root/poc/deviceConfigurator):

```bash
scripts/devconf deploy-lab \
    --topology <out>/topology.clab.yml --configs <out>/ [--reconfigure]
scripts/devconf inventory --lab-dir <clab-lab-dir>   # if not auto-imported
```

deploy-lab injects `<node>.cfg` / `<node>.partial.cfg` / `<node>.json`
from `--configs` as each node's startup-config; nodes without a matching
file boot with defaults.

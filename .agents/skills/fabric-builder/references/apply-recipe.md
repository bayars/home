# Applying generated configs via deviceConfigurator

All apply operations go through `scripts/devconf` in
`/root/poc/deviceConfigurator` (run from there). Never SSH into a router
and paste lines — that violates the device-configurator hard rules.

## Day-0 (lab not deployed / node containers not running)

```bash
cd /root/poc/deviceConfigurator
scripts/devconf deploy-lab \
    --topology /root/poc/fabricBuilder/output/<name>/topology.clab.yml \
    --configs  /root/poc/fabricBuilder/output/<name>/ [--reconfigure]
```

This injects each node's generated startup-config and regenerates the
ansible inventory (groups `srlinux`, `sros`).

## Day-2 (running nodes) — per device, in this order

Order devices: **spines before leaves** (SRL fabrics), **P before PE**
(SROS cores) — so RRs/transit exist when edge sessions come up.

```bash
cd /root/poc/deviceConfigurator
H=<host>; CFG=/root/poc/fabricBuilder/output/<name>/<node>.json   # SRL
# SROS: CFG=<node>.partial.cfg plus --platform sros on every call

scripts/devconf validate --host $H --config $CFG        # exit 2 -> fix, loop
scripts/devconf backup   --host $H                      # file + checkpoint
scripts/devconf push     --host $H --config $CFG        # default: merge
scripts/devconf get      --host $H --path "/network-instance[name=default]/protocols/bgp"
```

`--mode replace` only for swapping a whole known subtree, only after the
backup, and **never with path `/`** on SR Linux (fabgen never emits root
ops; keep it that way when hand-editing).

## Verify (after every push)

1. Config landed: `devconf get --host <h> --path <touched-subtree>`.
2. Independent state check over gNMI:

```bash
scripts/devconf get --host <h> --via gnmic --datastore state \
    --path "/network-instance[name=default]/protocols/bgp/neighbor[peer-address=<peer>]/session-state"
# EVPN fabrics, additionally:
#   .../neighbor[peer-address=<loopback>]/afi-safi[afi-safi-name=evpn]/active
#   /tunnel-interface[name=vxlan1]
#   /network-instance[name=<svc>]/oper-state
```

BGP sessions between loopbacks need both underlay sessions up first
(loopbacks are learned via the underlay) — expect the overlay to
establish a few seconds after the underlay.

## Exit codes / failure handling

| code | meaning | action |
|---|---|---|
| 0 | success | run the verify steps |
| 2 | validation/commit rejected | error names the offending path/leaf — fix the artifact (or the spec + `fabgen build` again), re-validate |
| 3 | transport / container not running | day-0 situation → `deploy-lab`; else check container + mgmt IP |
| 4 | bad input / unknown target | fix args; `devconf inventory --lab-dir <dir>` if the host is unknown |

Half-applied or misbehaving device:

```bash
scripts/devconf rollback --host <h> --checkpoint devconf        # your last backup
scripts/devconf rollback --host <h> --checkpoint clab-initial   # boot-time baseline
```

For repeatable experiments on the shared lab, start from
`--checkpoint clab-initial` and roll back to it when done.

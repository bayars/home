# SR OS MD-CLI config reference (syntax-verified only — no SROS image here)

Skeletons for hand-editing generated `<node>.partial.cfg` files. One
`configure { }` blob per node; applied by devconf in ONE session/commit
(`--platform sros`), or at boot as containerlab startup-config (keep
"partial" in the filename so it merges onto defaults).

## Day-0 hardware (vSIM sr-1 pattern)

```
card 1 {
    admin-state enable
    card-type iom-1
    mda 1 { admin-state enable  mda-type me6-100gb-qsfp28 }
}
port 1/1/1  { admin-state enable  ethernet { mode network } }
port 1/1/10 { admin-state enable  ethernet { mode access  encap-type dot1q } }
```

## router "Base" — IGP / MPLS / BGP

```
router "Base" {
    autonomous-system 65000
    router-id 10.10.10.11
    interface "system" { ipv4 { primary { address 10.10.10.11 prefix-length 32 } } }
    interface "to-p1" { port 1/1/1  ipv4 { primary { address 10.101.0.1 prefix-length 31 } } }
    isis 0 {
        admin-state enable
        level-capability 2
        area-address 49.0001            # system-id derives from system IP
        interface "system" { }
        interface "to-p1" { interface-type point-to-point }
    }
    ldp { admin-state enable  interface-parameters { interface "to-p1" { ipv4 { } } } }
    bgp {
        admin-state enable
        group "ibgp" {
            admin-state enable
            peer-as 65000
            local-address 10.10.10.11
            family { vpn-ipv4 true  evpn true }
            # RR only:  cluster { cluster-id 10.10.10.1 }
        }
        neighbor "10.10.10.1" { admin-state enable  group "ibgp" }
    }
}
```

OSPF alternative: `ospf 0 { admin-state enable  area 0.0.0.0 { interface ... } }`.

SR-ISIS alternative to LDP (inside router "Base"):

```
mpls-labels { sr-labels { start 19000  end 27999 } }
isis 0 {
    advertise-router-capability as
    segment-routing { admin-state enable  prefix-sid-range { global } }
    interface "system" { ipv4-node-sid { index 11 } }   # unique per node
}
```

## Services (RD `<system-ip>:<id>`, RT `target:<asn>:<id>`)

```
service {
    customer "1" { }

    vprn "100" {
        admin-state enable
        service-id 100
        customer "1"
        bgp-ipvpn { mpls {
            admin-state enable
            route-distinguisher "10.10.10.11:100"
            vrf-target { community "target:65000:100" }
            auto-bind-tunnel { resolution any }
        } }
        interface "site-1" {
            ipv4 { primary { address 172.16.0.1 prefix-length 24 } }
            sap 1/1/10:100 { }
        }
    }

    # EVPN-MPLS VPLS (adds `evpn true` to the BGP family)
    vpls "200" {
        admin-state enable
        service-id 200
        customer "1"
        bgp 1 {
            route-distinguisher "10.10.10.11:200"
            route-target { export "target:65000:200"  import "target:65000:200" }
        }
        bgp-evpn { evi 200  mpls 1 {
            admin-state enable
            auto-bind-tunnel { resolution any }
        } }
        sap 1/1/11:200 { }
    }

    # LDP SDP variant (non-EVPN vpls/epipe); sdp-id convention:
    # <service-id>*10 + <remote node number> (node number = last loopback octet)
    sdp 3012 {
        admin-state enable
        delivery-type mpls
        ldp true
        far-end { ip-address 10.10.10.12 }
    }
    epipe "300" {
        admin-state enable
        service-id 300
        customer "1"
        sap 1/1/12:300 { }
        spoke-sdp 3012:300 { }        # mesh-sdp for vpls
    }
}
```

## Verification (once SROS nodes exist)

- `devconf push --host <h> --platform sros --config <node>.partial.cfg`
  (mdcli default; `--sros-transport netconf` needs an `.xml` payload).
- `devconf get --host <h> --platform sros --via gnmic --datastore state`
  for BGP session / service oper state.
- Status: MD-CLI blobs here are template/golden-file verified; no SROS
  image/license exists in this environment, so nothing is live-tested
  (same caveat as deviceConfigurator).

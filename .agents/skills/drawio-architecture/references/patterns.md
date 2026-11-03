# Modelling patterns

How to turn a system into nodes, groups and edges that lay out well. Read the section that matches the request.

Contents: [Choosing what to show](#choosing-what-to-show) · [Cloud deployment](#cloud-deployment) · [Kubernetes](#kubernetes) · [Software and services](#software-and-services) · [Event-driven systems](#event-driven-systems) · [Data pipelines](#data-pipelines) · [C4](#c4) · [Network topology](#network-topology) · [Reading infrastructure code](#reading-infrastructure-code)

## Choosing what to show

A diagram answers one question for one audience. Decide which before listing components:

| Question | Show | Leave out |
|---|---|---|
| Where does it run? (deployment) | accounts, regions, networks, subnets, compute, data stores, gateways | internal modules, libraries |
| How do requests flow? (runtime) | clients, entry points, services, stores, queues, third parties | subnets, IAM, most networking |
| Who owns what? (logical) | systems, services grouped by team or domain | infrastructure |
| How is it wired? (network) | routers, firewalls, switches, VLANs, links | applications |

Mixing two of these is the usual cause of a diagram with 40 nodes. If the user asks for "the architecture" with no more detail, a runtime view with the main boundaries is the safest default; offer the deployment view as a second diagram.

Collapse repetition. Three identical app servers are one node labelled `App servers (3)`, unless showing them separately is the point (as with availability zones). Twelve microservices that all talk to the same queue and the same database can be one group with the four that matter drawn individually.

## Cloud deployment

Nest boundaries the way the cloud does, outermost first:

- AWS: `aws.cloud` or `aws.account` → `aws.region` → `aws.vpc` → `aws.az` → `aws.subnet_public` / `aws.subnet_private`. Add `aws.security_group` or `aws.asg` only when they matter to the question.
- Azure: `azure.subscription` → `azure.resource_group` → `azure.vnet` → `azure.subnet`. Use `azure.region` and `azure.az` for multi-region or zone-redundant designs.
- Google Cloud: `gcp.project` → `gcp.region` → `gcp.vpc` → `gcp.subnet`, with `gcp.zone` where zonal placement matters.

Place each resource at the level where it really lives:

- Regional or global services (S3, DynamoDB, SQS, CloudFront, Route 53, Cloud Storage, BigQuery, Service Bus, Front Door) go **outside** the VPC, at region or account level, or outside everything for global ones.
- A load balancer that spans zones goes in the VPC, not in one zone.
- Per-zone resources (instances, NAT gateways, database primary and standby) go in their subnet.

Users and third parties stay outside every boundary.

Zones and regions are parallel groups: they are placed side by side and edges between them (replication, cross-zone calls) are routed afterwards. Declare the zones in order (a, then b) and declare the subnets in each zone in the same order, so the zones mirror each other.

`examples/aws-web-app.json` and `examples/azure-web-app.json` show the pattern.

## Kubernetes

Decide whether the audience cares about Kubernetes objects or about workloads.

- **Objects view**: `k8s.cluster` → `k8s.namespace`, with `k8s.ingress`, `k8s.service`, `k8s.deployment`, `k8s.statefulset`, `k8s.configmap`, `k8s.pvc` nodes. Chain them as traffic flows: ingress → service → deployment. Draw ConfigMaps, Secrets and HPAs with dashed edges to what they affect. One namespace per group.
- **Workload view**: plain `service` boxes inside namespace groups, with the cloud's managed services around them as icons.

Do not draw nodes (`k8s.node`) unless scheduling or placement is the topic. Do not draw every pod; label the deployment `Deployment: web (3)`.

`examples/kubernetes-microservices.json` is an objects view.

## Software and services

Use box kinds, with `tech` for the language or product and `desc` for a one-line responsibility. Group by tier, domain or team with `group` and a `color` per group; use `boundary` for a trust or network boundary and for third parties.

Edges are calls: label them with the protocol or the operation (`REST`, `gRPC`, `SQL`, `charge`). Draw an edge only when the relationship itself matters; shared libraries, logging and metrics that touch everything are better as a sentence in a `note`.

A legend earns its place as soon as the diagram uses dashed lines or more than three colours: a `note` node with one line per convention.

`examples/software-services.json` shows the pattern.

## Event-driven systems

Draw the broker or topic as a node (`queue` kind, or the vendor icon), never as a bare edge. Producers point to the topic, the topic points to consumers, and both are dashed. This keeps "who publishes" and "who consumes" readable and stops the diagram becoming a mesh.

A consumer that sits earlier in the main flow than the topic creates an edge against the flow. Mark that edge `"layout": false` so it does not stretch the diagram.

## Data pipelines

Lay out `right`. Group by stage (ingest, process, store and serve), in that order, and declare nodes in the order data moves. Sources go on the far left, consumers (dashboards, analysts) on the far right. Label edges with what moves (`events`, `batch`, `CDC`) rather than the protocol.

If you use a zone or region kind for a stage only because of its colour, set `"parallel": false` on it; otherwise edges between stages will not shape the layout. Plain `group` with a `color` avoids the issue.

`examples/gcp-data-pipeline.json` shows the pattern.

## C4

Use `"direction": "down"`. One diagram per level; do not mix levels.

- **Context**: `c4.person`, one `c4.system`, the `c4.external` systems around it. No boundary needed.
- **Container**: a `c4.boundary` group for the system, `c4.container` and `c4.database` nodes inside, people and external systems outside.
- **Component**: a `c4.boundary` for one container, `c4.component` nodes inside, neighbouring containers outside as `c4.container`.

Give every element a `desc` (one sentence: what it does) and every container and component a `tech`. Label every edge with a verb phrase and, on a second line, the protocol: `"Reads and writes\n[SQL/TCP]"`.

`examples/c4-container.json` is a container view.

## Network topology

Use `"direction": "down"`: internet at the top, edge devices, then internal zones. Physical links have no direction, so set `"arrow": "none"` on them and reserve arrows for flows. Use `cisco.*` icons for Cisco-specific gear and `net.*` for vendor-neutral equipment (`net.server`, `net.firewall`, `net.router`, `net.switch`, `net.pc`, `net.laptop`, `net.storage`). Group by security zone or VLAN with `boundary`, and label the group with the subnet.

Hub-and-spoke designs read best with the hub declared first and each spoke as a group.

`examples/onprem-network.json` shows the pattern.

## Reading infrastructure code

Take the inventory from the files, then apply the patterns above. Typical mappings:

| Source | Becomes |
|---|---|
| Terraform `aws_vpc`, `aws_subnet`, `azurerm_virtual_network`, `google_compute_network` | groups, nested by their `vpc_id` / `virtual_network_name` references |
| Terraform compute, database, queue and storage resources | icon nodes, placed in the subnet or level they reference |
| Terraform `count` / `for_each` | one node with a count in the label, unless per-zone placement matters |
| Security group rules, IAM policies, route tables | edges or omitted; draw them only if access paths are the question |
| docker-compose `services` | `service` or `database` boxes; `depends_on` and connection environment variables give the edges; `networks` give the groups |
| Kubernetes `Deployment`, `StatefulSet`, `Service`, `Ingress`, `ConfigMap`, `PersistentVolumeClaim` | the matching `k8s.*` icons; `namespace` gives the groups; selectors and `backend` references give the edges |
| Helm values, Kustomize overlays | read the rendered or base manifests; say which environment you drew |

Module boundaries in Terraform are a good hint for groups, but they describe code organisation, which is not always where things run. Prefer runtime boundaries.

Flows are often not in the infrastructure code at all. Look for them in application configuration (connection strings, queue names, service URLs). Where a flow is inferred rather than found, say so in your reply rather than drawing it with confidence.

Never copy a secret, key, password or full connection string into a label. Name the thing (`Orders DB`), not its credentials.

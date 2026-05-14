# Architecture diagrams

Source-of-truth Mermaid files for every diagram in `../ARCHITECTURE-V2.md`. Each `.mmd` is a standalone block that can be:

- **Pasted into [mermaid.live](https://mermaid.live)** for instant SVG / PNG export
- **Imported into Excalidraw** via the official Mermaid plugin
- **Imported into draw.io** via `Arrange → Insert → Advanced → Mermaid`
- **Previewed in VS Code** with the *Markdown Preview Mermaid Support* extension
- **Rendered in GitHub** if you paste them inside a `` ```mermaid `` fence in a markdown file

## File index

| # | File | Diagram | Use for |
|---|---|---|---|
| 1 | `01-technical-architecture.mmd` | Layered modular monolith | Engineering overview, hiring, onboarding |
| 2 | `02-business-architecture.mmd` | Actors × capabilities map | Leadership, investor decks |
| 3 | `03-data-flow.mmd` | Sequence: QR → feedback | API design discussions, debugging |
| 4 | `04-infrastructure-scaling.mmd` | Phase 1-4 evolution | Infrastructure planning, cost reviews |
| 5 | `05-realtime-sse.mmd` | EventEmitter + channels | Realtime/SSE design rationale |
| 6 | `06-order-state-machine.mmd` | Full status graph | Engineering ref, dispute resolution |
| 7 | `07-ecosystem.mmd` | Hub-and-spoke | Pitch deck, marketing site |
| 8 | `08-live-ops.mmd` | Signals → tiles → escalation | Ops planning, runbook |
| 9 | `09-multi-tenant.mmd` | Brand → Restaurant → Branch | Tenancy model conversations |
| 10 | `10-journey-customer.mmd` | Customer UX journey | Product, design reviews |
| 10 | `10-journey-rider.mmd` | Rider UX journey | Product, design reviews |
| 10 | `10-journey-restaurant.mmd` | Restaurant UX journey | Product, design reviews |
| 10 | `10-journey-superadmin.mmd` | Super-admin UX journey | Product, design reviews |
| 11 | `11-scaling-roadmap.mmd` | Gantt of growth phases | Roadmap reviews, fundraising |

## Quick export

```sh
# Bulk render to SVG via mermaid-cli (one-time install)
npx -y @mermaid-js/mermaid-cli -i 01-technical-architecture.mmd -o 01.svg
```

The doc itself is at `../ARCHITECTURE-V2.md`.

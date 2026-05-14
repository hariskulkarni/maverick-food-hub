# Hosting Decision — Maverick's Food Hub Phase 1

**Researched:** May 2026 · **Target spec:** 4 vCPU · 8 GB RAM · 100+ GB NVMe · 5+ TB bandwidth · Mumbai/Bangalore region · ~₹4,000/mo budget · production SLA · INR billing with GST.

The decision below is calibrated to **Phase 1 of the architecture roadmap** in `ARCHITECTURE-V2.md` — single VPS hosting the Next.js monolith, PostgreSQL, nginx, PM2, and local FS uploads, fronted by Cloudflare.

---

## TL;DR — recommendation

| Rank | Provider | Why | Plan | Monthly cost (incl. GST) |
|---|---|---|---|---|
| **1 ✅** | **Hostinger KVM 4 (Mumbai)** | Best value in the market for our spec; native INR billing; GST invoicing; Mumbai DC; well-reviewed reliability | KVM 4 · 4 vCPU · 16 GB RAM · 200 GB NVMe · 16 TB bandwidth | **₹849–₹1,099** |
| **2** | **DigitalOcean Bangalore** | Best developer experience and tooling; API + Terraform first-class; great docs; easy snapshots and floating IPs; pay-as-you-go | Premium AMD · 4 vCPU · 8 GB · 160 GB NVMe · 5 TB | ~₹3,400 ($40) + 18% GST |
| **3** | **E2E Networks (Mumbai/Delhi/Bangalore)** | Indian company; INR-native; GST automatic; strong local support; data residency story | C2.8GB or C2.16GB plan | ~₹2,500–₹3,500 |

The strong recommendation is **Hostinger KVM 4** for Phase 1. It's the lowest cost, fits the spec with headroom (16 GB RAM vs. our 8 GB target), invoices in INR with GST, and runs from a Mumbai DC for low customer-side latency. If you ever need to migrate, the Phase 2 transition to S3-compatible storage (Cloudflare R2 or Vultr Object Storage) is provider-agnostic and the move from Hostinger → DigitalOcean Bangalore is a one-day operation.

---

## Why not the other obvious options

### AWS Mumbai (EC2 / Lightsail)

- **Cost:** ~₹5,500–₹8,000/mo for an equivalent `t3.large` instance. The Mumbai region carries a ~15–20% premium over `us-east-1`, and Lightsail's bandwidth allowance is **halved** in Mumbai (1.5 TB vs 3 TB in US for the same dollar price).
- **Complexity:** IAM, VPC, security groups, EBS, ELB — you'd burn 2 weeks on networking before deploying.
- **Verdict:** Save AWS for Phase 3+ when you legitimately need the regional spread.

### Azure / GCP

- Same story as AWS — billing complexity, INR conversion lag, no real Phase 1 advantage.

### Hetzner (Germany / Singapore)

- World-class price-performance — but **no India data center**.
- Singapore route adds **40–60 ms latency** to Indian metros. Acceptable for APIs and dashboards. Unacceptable for our SSE-heavy realtime tracking flow (rider GPS pings need ~250 ms end-to-end to feel "live").
- **Verdict:** Disqualified for customer-facing Phase 1. Worth revisiting only if you set up edge POPs in front.

### Vercel / Railway / Render (PaaS)

- **Vercel:** Brilliant for static and edge functions, but our Next.js server uses long-lived SSE connections and a single-process EventEmitter for fan-out. Serverless cold starts will kill rider GPS pings and SSE channels. The free tier is 100 GB bandwidth (we'd burn that in week 1 at production scale). Real-world cost for our workload: $100–$300/mo on Pro + Postgres add-on.
- **Railway:** No permanent free tier — new accounts get a one-time $5 credit, then $1/mo credit, then services pause. Production workload would land at $40–$80/mo for the app + $20+ for Postgres = **$60–100/mo (~₹5,000–₹8,500/mo)**. Reasonable, but you give up SSH and PM2 control.
- **Render:** Free tier has a 1 GB Postgres that **expires after 30 days**. Paid Postgres starts at $19/mo. App service for our spec is ~$25/mo. Total ~$50/mo (~₹4,200/mo) — within budget but no Mumbai region (closest is Singapore).

**Verdict on PaaS:** All three are great for solo developers and prototypes. For Phase 1 of a production India-first business with SSE + cron + KOT printing + signup-bonus state machines, you want a real Linux box you can SSH into. Once we're at Phase 4 and split out the ML dispatch service, PaaS for that one service becomes attractive.

### Cloudways / managed wrappers

- Adds ~50–100% markup over raw DigitalOcean or Vultr (managed-DO 8 GB plan at Cloudways = **$88/mo**, raw DigitalOcean = **$40/mo**).
- You're paying for a control panel and a server-side LAMP stack we don't use.
- **Verdict:** Skip. We already have PM2 + nginx + Postgres muscle memory from the deploy docs.

### Indian players we considered but didn't pick

| Provider | Why not (yet) |
|---|---|
| **MilesWeb** | Good INR/GST coverage, NVMe, 99.9% SLA, but pricing for our exact spec is similar to Hostinger with less mature self-service UX |
| **Cantech** | 99.97% uptime claim is great; comparable pricing; slightly weaker public benchmarks |
| **YouStable / DomainRacer / HostingRaja / BigRock** | Older shared-hosting heritage; weaker SLAs; less suitable for a production Node app |
| **CtrlS / Tata Communications** | Enterprise tier — overkill cost for Phase 1 (₹15k+/mo) |

---

## Phase-by-phase host strategy

Aligned with the scaling roadmap in `ARCHITECTURE-V2.md`:

| Phase | Workload | Host | Approx monthly cost |
|---|---|---|---|
| **1** | 1 VPS · 20 restaurants · 5k DAU | **Hostinger KVM 4 (Mumbai)** + Cloudflare Free | **₹1,000–₹1,200** |
| **2** | + object storage + Redis + CDN | Hostinger KVM 4 + Cloudflare R2 + Hostinger Redis (or Upstash free tier) | ₹2,000–₹3,000 |
| **3** | DB split + multi-app | DigitalOcean Bangalore (2× app boxes) + DigitalOcean Managed Postgres + PgBouncer | ₹25,000–₹40,000 |
| **4** | ML dispatch + warehouse | Above + GCP `ap-south-1` for the warehouse + a small Render service for the dispatch ML | ₹70,000–₹1,00,000 |

The Phase 1 → Phase 2 jump is just adding services; no migration. The Phase 2 → Phase 3 jump is a one-day DNS swap because the storage adapter and SSE backplane are already abstracted in the codebase.

---

## The Hostinger KVM 4 + Cloudflare setup (recommended)

If you go with the recommendation, here's the concrete day-1 setup:

### Order

1. Buy **Hostinger VPS → KVM 4** plan in their **India / Mumbai** data center. Pick a 12-month term for the best per-month price; you can extend later.
2. Operating system: **Ubuntu 24.04 LTS** (minimal) — matches the deploy docs in `DEPLOY-INDIA.md`.
3. Tick "GST invoice" on the order form and add your business GSTIN.

### Lock down

4. Set up SSH key auth; disable password login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
5. UFW firewall: allow 22 (SSH), 80, 443. Deny everything else by default.
6. Install fail2ban with the default Ubuntu profile.

### Install the stack

7. `sudo apt install -y nodejs npm postgresql nginx certbot python3-certbot-nginx`
8. `sudo npm install -g pm2` and `pm2 startup systemd`.
9. Postgres: `sudo -u postgres createuser maverick && createdb maverick_prod -O maverick`.
10. Clone the repo, `npm ci && npm run build`, then `pm2 start npm --name maverick -- start`.

### Front it

11. Cloudflare Free: add your domain, change name servers, set "Proxied" on the A record pointing to the VPS IP.
12. Set SSL/TLS mode to **Full (strict)** in Cloudflare.
13. Use `certbot --nginx -d yourdomain.com` for the origin cert.
14. Enable Cloudflare's "Auto Minify" off (Next.js handles its own minification) but turn ON "Brotli" and "Always Use HTTPS".

### Backups

15. `crontab -e` and add `0 3 * * * /usr/bin/pg_dump -U maverick maverick_prod | gzip | aws s3 cp - s3://your-bucket/backup-$(date +\%F).sql.gz` — point at Cloudflare R2 or a Backblaze B2 bucket (both essentially free at our scale).
16. Snapshot the whole VPS weekly in the Hostinger control panel.

### Monitoring

17. UptimeRobot free tier — set up HTTPS checks on `/`, `/api/health`, and the SSE endpoint.
18. Pino logs already write to `~/.pm2/logs/*.log`; rotate weekly via `pm2-logrotate`.

Total stand-up time: **about 4 hours** once you have an SSH key and a domain.

---

## Migration safety net

If Hostinger ever underperforms (rare per current reviews, but possible), the **escape hatch** is a same-day rebuild on DigitalOcean Bangalore:

1. Spin up a $40/mo Premium AMD 4vCPU/8GB droplet.
2. `pg_restore` the latest nightly backup.
3. Pull the same repo and `pm2 start`.
4. Switch the Cloudflare A record.

Because Cloudflare proxies the DNS, the cutover is **DNS-instant** with no propagation delay. Total downtime: ~10 minutes for the DB warm-up.

---

## Decision

> **Go with Hostinger KVM 4 (Mumbai) + Cloudflare Free for Phase 1.**
> Budget: ₹1,000–₹1,200/month all-in (with GST). Headroom: 2× our spec target on RAM, 2× on bandwidth. Migration path to DigitalOcean is pre-engineered into the architecture and validated by the storage adapter + SSE abstraction in the codebase.

The single biggest reason to choose this over DigitalOcean for Phase 1: at ~₹1,000/mo it costs **3× less than DO** for a strictly larger machine, INR-billed with GST, no FX volatility, and Mumbai-resident. If you grow into the larger problems DO solves better (managed databases, snapshots, Terraform-managed infra), we move in Phase 3.

---

## Sources

- [Hostinger India VPS Mumbai data center](https://www.hostinger.com/in/vps-hosting)
- [Hostinger KVM 4 plan benchmarks (vpsbenchmarks.com)](https://www.vpsbenchmarks.com/hosters/hostinger/plans/kvm-4)
- [Hostinger VPS 2026 review (HostAdvice)](https://hostadvice.com/hosting-company/hostinger-reviews/hostinger-vps-hosting-review/)
- [Hostinger pricing — India (hostingcharges.in)](https://www.hostingcharges.in/reviews/hostinger-india)
- [DigitalOcean pricing](https://www.digitalocean.com/pricing)
- [DigitalOcean Bangalore region details (BetterStack)](https://betterstack.com/community/guides/web-servers/digitalocean-vs-linode/)
- [E2E Networks pricing calculator](https://calculator.e2enetworks.com/)
- [E2E Networks 2026 review (WebsitePlanet)](https://www.websiteplanet.com/web-hosting/e2e-networks/)
- [Vultr pricing](https://www.vultr.com/pricing/)
- [Vultr vs DigitalOcean comparison (VPSBenchmarks)](https://www.vpsbenchmarks.com/compare/docean_vs_vultr)
- [Hetzner latency to India test](https://hetzner-latency.sliplane.io/)
- [Hetzner 2026 review and trade-offs (BetterStack)](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/)
- [ZenoCloud vs Hetzner — Indian managed vs Europe budget](https://zenocloud.io/blog/zenocloud-vs-hetzner/)
- [AWS Lightsail pricing](https://aws.amazon.com/lightsail/pricing/)
- [AWS Lightsail Mumbai true-cost breakdown (CloudBurn)](https://cloudburn.io/blog/amazon-lightsail-pricing)
- [Cloudways pricing](https://www.cloudways.com/en/pricing.php)
- [Railway pricing 2026](https://railway.com/pricing)
- [Render free tier review 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [Vercel pricing](https://vercel.com/pricing)
- [Cheapest VPS in India 2026: pricing with GST (TechPlained)](https://www.techplained.com/cheapest-vps-india)
- [Top 10 VPS hosting providers India 2026 (YouStable)](https://www.youstable.com/blog/best-vps-hosting-providers-in-india)
- [MilesWeb 2026 review (HostAdvice)](https://hostadvice.com/hosting-company/milesweb-reviews/)
- [Cantech best VPS providers 2026](https://www.cantech.in/blog/best-vps-hosting-providers/)

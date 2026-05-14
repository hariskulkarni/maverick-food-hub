#!/usr/bin/env python3
"""
Hand-rolled SVG generator for the 10 architecture diagrams. No Mermaid runtime
needed — we lay out boxes + arrows directly and then render to PNG via
cairosvg. Tuned for a clean enterprise look on white backgrounds with the
same palette used in ARCHITECTURE-V2.md.

Run:  python3 build-pngs.py
"""

import os, sys, html
import cairosvg

OUT = os.path.dirname(os.path.abspath(__file__))

# ── Palette ────────────────────────────────────────────────────────────────
PAL = {
    'client':  ('#fef3e7', '#d97706', '#7c2d12'),
    'edge':    ('#eef2ff', '#4338ca', '#1e1b4b'),
    'app':     ('#ecfdf5', '#059669', '#064e3b'),
    'data':    ('#f1f5f9', '#475569', '#0f172a'),
    'ext':     ('#fdf4ff', '#a21caf', '#581c87'),
    'ops':     ('#fefce8', '#a16207', '#713f12'),
    'actor':   ('#fff7ed', '#ea580c', '#7c2d12'),
    'core':    ('#eef2ff', '#4338ca', '#1e1b4b'),
    'growth':  ('#ecfdf5', '#059669', '#064e3b'),
    'p1':      ('#ecfdf5', '#059669', '#064e3b'),
    'p2':      ('#eff6ff', '#2563eb', '#1e3a8a'),
    'p3':      ('#fef3c7', '#d97706', '#78350f'),
    'p4':      ('#fce7f3', '#be185d', '#831843'),
    'alert':   ('#fee2e2', '#b91c1c', '#7f1d1d'),
    'warn':    ('#fef3c7', '#b45309', '#78350f'),
    'src':     ('#e0e7ff', '#4338ca', '#1e1b4b'),
    'esc':     ('#f3e8ff', '#7c3aed', '#581c87'),
    'pub':     ('#fef3c7', '#b45309', '#78350f'),
    'bus':     ('#ede9fe', '#5b21b6', '#3c1361'),
    'sub':     ('#ecfeff', '#0e7490', '#164e63'),
    'cuisine': ('#dcfce7', '#15803d', '#14532d'),
    'branch':  ('#e0e7ff', '#4338ca', '#1e1b4b'),
    'leaf':    ('#ffffff', '#94a3b8', '#334155'),
    'hub':     ('#fbbf24', '#92400e', '#451a03'),
    'spoke':   ('#ffffff', '#374151', '#111827'),
    'state_normal': ('#eef2ff', '#4338ca', '#1e1b4b'),
    'state_end':    ('#dcfce7', '#15803d', '#14532d'),
    'state_fail':   ('#fee2e2', '#b91c1c', '#7f1d1d'),
}

FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

# ── SVG primitives ────────────────────────────────────────────────────────

def svg_open(w, h, title):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family='{FONT}'>
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/>
  </marker>
  <marker id="arrow-dash" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
  </marker>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.08"/>
  </filter>
</defs>
<rect width="{w}" height="{h}" fill="#ffffff"/>
<text x="48" y="56" font-size="32" font-weight="700" fill="#0f172a">{html.escape(title)}</text>
'''

def svg_close():
    return '</svg>\n'

def subtitle(text, x, y, color='#475569'):
    return f'<text x="{x}" y="{y}" font-size="15" fill="{color}">{html.escape(text)}</text>\n'

def box(x, y, w, h, label, palette='client', font_size=14, sub=None, rx=10):
    fill, stroke, text = PAL[palette]
    lines = label.split('\n')
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" ry="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5" filter="url(#shadow)"/>']
    n = len(lines)
    line_h = font_size * 1.25
    if sub:
        n += 1
    total_h = n * line_h
    start_y = y + (h - total_h) / 2 + line_h * 0.8
    for i, ln in enumerate(lines):
        out.append(f'<text x="{x + w/2}" y="{start_y + i*line_h}" text-anchor="middle" font-size="{font_size}" font-weight="600" fill="{text}">{html.escape(ln)}</text>')
    if sub:
        out.append(f'<text x="{x + w/2}" y="{start_y + len(lines)*line_h}" text-anchor="middle" font-size="11" fill="#64748b" font-style="italic">{html.escape(sub)}</text>')
    return '\n'.join(out) + '\n'

def cylinder(x, y, w, h, label, palette='data', font_size=14, sub=None):
    """DB cylinder shape."""
    fill, stroke, text = PAL[palette]
    e = 10  # ellipse rx, h
    out = [
        f'<path d="M {x} {y+e} A {w/2} {e} 0 0 1 {x+w} {y+e} L {x+w} {y+h-e} A {w/2} {e} 0 0 1 {x} {y+h-e} Z" fill="{fill}" stroke="{stroke}" stroke-width="1.5" filter="url(#shadow)"/>',
        f'<ellipse cx="{x+w/2}" cy="{y+e}" rx="{w/2}" ry="{e}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>',
    ]
    lines = label.split('\n')
    n = len(lines)
    line_h = font_size * 1.25
    if sub: n += 1
    total_h = n * line_h
    start_y = y + (h - total_h) / 2 + line_h * 0.8 + 4
    for i, ln in enumerate(lines):
        out.append(f'<text x="{x + w/2}" y="{start_y + i*line_h}" text-anchor="middle" font-size="{font_size}" font-weight="600" fill="{text}">{html.escape(ln)}</text>')
    if sub:
        out.append(f'<text x="{x + w/2}" y="{start_y + len(lines)*line_h}" text-anchor="middle" font-size="11" fill="#64748b" font-style="italic">{html.escape(sub)}</text>')
    return '\n'.join(out) + '\n'

def circle(cx, cy, r, label, palette='actor', font_size=13):
    fill, stroke, text = PAL[palette]
    out = [f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2" filter="url(#shadow)"/>']
    lines = label.split('\n')
    n = len(lines)
    lh = font_size * 1.2
    start = cy - (n - 1) * lh / 2 + font_size/3
    for i, ln in enumerate(lines):
        out.append(f'<text x="{cx}" y="{start + i*lh}" text-anchor="middle" font-size="{font_size}" font-weight="700" fill="{text}">{html.escape(ln)}</text>')
    return '\n'.join(out) + '\n'

def diamond(cx, cy, w, h, label, palette='esc', font_size=12):
    fill, stroke, text = PAL[palette]
    pts = f"{cx},{cy-h/2} {cx+w/2},{cy} {cx},{cy+h/2} {cx-w/2},{cy}"
    out = [f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="1.5" filter="url(#shadow)"/>']
    lines = label.split('\n')
    n = len(lines)
    lh = font_size * 1.2
    start = cy - (n - 1) * lh / 2 + font_size/3
    for i, ln in enumerate(lines):
        out.append(f'<text x="{cx}" y="{start + i*lh}" text-anchor="middle" font-size="{font_size}" font-weight="600" fill="{text}">{html.escape(ln)}</text>')
    return '\n'.join(out) + '\n'

def group(x, y, w, h, title, palette='leaf'):
    fill, stroke, _ = PAL[palette]
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" ry="14" '
        f'fill="none" stroke="{stroke}" stroke-width="1" stroke-dasharray="6,4" opacity="0.45"/>'
        f'<text x="{x+16}" y="{y+24}" font-size="13" font-weight="700" fill="{stroke}" letter-spacing="1.5">'
        f'{html.escape(title.upper())}</text>\n'
    )

def arrow(x1, y1, x2, y2, label=None, dashed=False, color='#64748b'):
    dash = ' stroke-dasharray="5,4"' if dashed else ''
    marker = 'url(#arrow-dash)' if dashed else 'url(#arrow)'
    out = [f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{color}" stroke-width="1.6" fill="none"{dash} marker-end="{marker}"/>']
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2 - 6
        out.append(f'<rect x="{mx-len(label)*3.5}" y="{my-10}" width="{len(label)*7}" height="16" rx="3" fill="white" opacity="0.9"/>')
        out.append(f'<text x="{mx}" y="{my+2}" text-anchor="middle" font-size="11" fill="#475569">{html.escape(label)}</text>')
    return '\n'.join(out) + '\n'

def line(x1, y1, x2, y2, dashed=False, color='#cbd5e1', sw=1):
    dash = ' stroke-dasharray="4,4"' if dashed else ''
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}"{dash}/>\n'

def legend(x, y, items):
    """items = [(palette, 'label'), ...]"""
    out = [f'<g transform="translate({x}, {y})">']
    for i, (pal, lbl) in enumerate(items):
        fill, stroke, _ = PAL[pal]
        cy = i * 24
        out.append(f'<rect x="0" y="{cy}" width="20" height="14" rx="3" fill="{fill}" stroke="{stroke}"/>')
        out.append(f'<text x="28" y="{cy+11}" font-size="12" fill="#334155">{html.escape(lbl)}</text>')
    out.append('</g>\n')
    return '\n'.join(out)

# ── Diagram 1 — Technical Architecture ────────────────────────────────────

def diagram_01():
    W, H = 1800, 1180
    s = svg_open(W, H, 'Technical Architecture — Layered modular monolith')
    s += subtitle('Maverick’s Food Hub · Next.js 15 · Prisma · PostgreSQL · SSE · single VPS', 48, 84)

    # Layer 1: Clients (top)
    s += group(48, 110, 1704, 130, 'Client tier')
    cx = [80, 420, 760, 1100, 1440]
    cw = 280
    clients = [
        ('Customer PWA', 'QR entry · menu · cart · OTP · tracker'),
        ('Rider Android', 'Capacitor wrapper + GPS service'),
        ('Restaurant Admin', 'Orders · menu · offers · happy hours'),
        ('Kitchen Panel', 'KOT · prep · ready · delay alerts'),
        ('Super Admin Portal', 'KYC · reconcile · analytics · live ops'),
    ]
    for i, (name, sub) in enumerate(clients):
        s += box(cx[i], 150, cw, 78, name, 'client', sub=sub)

    # Layer 2: Edge
    s += group(48, 260, 1704, 90, 'Edge tier')
    s += box(420, 280, 360, 60, 'Cloudflare', 'edge', sub='DNS · WAF · CDN · SSL')
    s += box(1020, 280, 360, 60, 'nginx reverse proxy', 'edge', sub='TLS termination · static cache · gzip')
    s += arrow(600, 340, 1020, 340)

    # Layer 3: Application
    s += group(48, 370, 1704, 360, 'Application tier · Next.js 15 modular monolith')
    apps = [
        (80,  420, 'Next.js server', 'App Router · React Server Components · React 19'),
        (440, 420, 'API routes', 'REST · /api/*'),
        (800, 420, 'NextAuth v5', 'OTP · email · Google OAuth'),
        (1160, 420, 'Order machine', 'State transitions · side effects'),
        (1520, 420, 'SSE fan-out', 'EventEmitter · channel:* subscribers'),
        (80,  550, 'Offer + Happy Hour', 'Resolvers · redemption math'),
        (440, 550, 'Challenges + Signup bonus', 'Lifecycle · reward emission'),
        (800, 550, 'Alerts + Audit', 'Debounce · NotificationLog'),
        (1160, 550, 'Storage adapter', 'Local FS · S3 · R2'),
        (1520, 550, 'Pricing engine', 'Discount · bonus · tax'),
    ]
    for (x, y, name, sub) in apps:
        s += box(x, y, 240, 100, name, 'app', sub=sub)

    # Layer 4: Data
    s += group(48, 750, 1704, 130, 'Data tier')
    s += box(420, 780, 360, 80, 'Prisma ORM', 'data', sub='Type-safe queries · generated client')
    s += cylinder(880, 780, 280, 80, 'PostgreSQL 16', 'data', sub='Single primary on VPS')
    s += box(1240, 780, 360, 80, 'Backups', 'data', sub='Nightly pg_dump → encrypted off-site')

    # Layer 5: Externals
    s += group(48, 900, 1100, 240, 'External providers')
    ext = [
        (80,  940, 'Razorpay', 'UPI · cards · COD'),
        (340, 940, 'SMS provider', 'MSG91 / Fast2SMS'),
        (600, 940, 'Email SMTP', 'Zoho · Brevo'),
        (860, 940, 'OSM + Nominatim', 'Free maps & geocoding'),
    ]
    for (x, y, name, sub) in ext:
        s += box(x, y, 240, 80, name, 'ext', sub=sub)

    # Layer 6: Ops
    s += group(1170, 900, 580, 240, 'Operations')
    s += box(1200, 940, 240, 80, 'PM2', 'ops', sub='Process supervisor · auto-restart')
    s += box(1480, 940, 240, 80, 'Pino + UptimeRobot', 'ops', sub='Logs · external health checks')
    s += box(1340, 1040, 240, 80, 'Ubuntu 22.04 VPS', 'ops', sub='4 vCPU · 8 GB RAM')

    # Arrows between layers (representative — clean look, not exhaustive)
    s += arrow(900, 230, 900, 280)  # clients → edge
    s += arrow(1200, 340, 1200, 420)  # edge → app
    s += arrow(560, 650, 560, 780)  # app → data
    s += arrow(900, 860, 200, 940, dashed=True)  # app → externals

    # Legend
    s += legend(48, 96, [
        ('client', 'Clients'),
        ('edge', 'Edge'),
        ('app', 'App'),
        ('data', 'Data'),
        ('ext', 'External'),
        ('ops', 'Operations'),
    ])
    return s + svg_close()

# ── Diagram 2 — Business Architecture ────────────────────────────────────

def diagram_02():
    W, H = 1800, 1100
    s = svg_open(W, H, 'Business Architecture — Actors × capabilities')
    s += subtitle('Six business actors map to four core, six growth, and five operational capabilities.', 48, 84)

    # Actor column on the left
    s += group(48, 110, 220, 920, 'Actors')
    actors = [('Customer','#fff7ed'), ('Restaurant\nOwner',''), ('Kitchen\nStaff',''), ('Rider',''), ('Super\nAdmin',''), ('Platform\nOperator','')]
    for i, (name, _) in enumerate(actors):
        s += circle(158, 180 + i*140, 56, name, 'actor', font_size=14)

    # Core capabilities
    s += group(310, 110, 460, 460, 'Core capabilities')
    cores = [('Ordering &\nCheckout','core'), ('Kitchen\nOperations','core'), ('Delivery\nOperations','core'), ('Payments\n& COD','core')]
    for i, (n, p) in enumerate(cores):
        x = 330 + (i%2) * 220
        y = 150 + (i//2) * 200
        s += box(x, y, 200, 160, n, p, font_size=15)

    # Growth capabilities
    s += group(800, 110, 470, 920, 'Growth capabilities')
    grow = [('Offers &\nCoupons',), ('Happy Hour\nPricing',), ('Cross-channel\nCampaigns',), ('Challenges &\nGamification',), ('Signup Bonus\n& Loyalty',), ('Cross-sell\n& Combos',)]
    for i, (n,) in enumerate(grow):
        x = 820 + (i%2) * 220
        y = 150 + (i//2) * 290
        s += box(x, y, 200, 240, n, 'growth', font_size=15)

    # Operational capabilities
    s += group(1300, 110, 450, 920, 'Operational capabilities')
    ops = [('Rider Mgmt\n+ KYC',), ('Multi-cuisine\nUmbrella',), ('Feedback\n& Quality',), ('Analytics\n& Reporting',), ('Support &\nReconciliation',)]
    for i, (n,) in enumerate(ops):
        x = 1320 + (i%2) * 210
        y = 150 + (i//2) * 250
        s += box(x, y, 190, 200, n, 'ext', font_size=15)
    # last item centered
    s += box(1425, 900, 190, 110, ops[4][0], 'ext', font_size=15)

    # arrows from actors to capabilities (representative)
    s += arrow(214, 180, 330, 230, 'places orders')
    s += arrow(214, 320, 330, 350, 'configures')
    s += arrow(214, 460, 330, 480, 'prepares')
    s += arrow(214, 600, 330, 510, 'delivers')
    s += arrow(214, 740, 800, 230, 'configures', dashed=True)
    s += arrow(214, 880, 1300, 880, 'reconciles', dashed=True)

    return s + svg_close()

# ── Diagram 3 — Data Flow ────────────────────────────────────────────────

def diagram_03():
    W, H = 1800, 1100
    s = svg_open(W, H, 'Data Flow — QR scan to delivered feedback')
    s += subtitle('Sequence: customer browse → checkout → kitchen → rider → delivery OTP → feedback', 48, 84)
    actors = [
        ('Customer\n(PWA)', 'client'),
        ('Next.js\nserver', 'app'),
        ('Postgres', 'data'),
        ('SSE\nfan-out', 'app'),
        ('Razorpay', 'ext'),
        ('SMS', 'ext'),
        ('Kitchen', 'client'),
        ('Rider\nApp', 'client'),
    ]
    n = len(actors)
    col_w = (W - 96) / n
    col_x = [48 + 60 + col_w * i for i in range(n)]
    top_y = 130
    # actor headers
    for i, (label, pal) in enumerate(actors):
        s += box(col_x[i]-80, top_y, 160, 70, label, pal, font_size=13)
        s += line(col_x[i], top_y+72, col_x[i], H-60, color='#cbd5e1', sw=1)
    # messages
    y = top_y + 110
    msgs = [
        (0,1,'GET /r/[slug] (QR)', '#0e7490'),
        (1,2,'SELECT restaurant + menu', '#0e7490'),
        (2,1,'rows', '#94a3b8'),
        (1,0,'SSR HTML + offers', '#94a3b8'),
        (0,1,'POST /api/auth/otp', '#0e7490'),
        (1,5,'send 6-digit code', '#a21caf'),
        (5,0,'SMS delivered', '#94a3b8'),
        (0,1,'signIn { phone, code }', '#0e7490'),
        (1,2,'upsert User · grant bonus', '#0e7490'),
        (0,1,'POST /api/orders', '#0e7490'),
        (1,2,'TX: apply hh + offers + bonus + INSERT', '#0e7490'),
        (1,4,'create payment intent', '#a21caf'),
        (4,1,'webhook (HMAC signed)', '#94a3b8'),
        (1,3,'publish branch:X:orders', '#059669'),
        (3,6,'order:new event', '#94a3b8'),
        (6,1,'transition → ACCEPTED → READY', '#0e7490'),
        (1,3,'publish order:Y status', '#059669'),
        (3,0,'live status updates (SSE)', '#94a3b8'),
        (7,1,'claim order', '#0e7490'),
        (1,2,'TX: RiderAssignment + payout', '#0e7490'),
        (7,1,'GPS ping (every 5s)', '#0e7490'),
        (1,3,'publish order:Y gps', '#059669'),
        (7,1,'verify-otp · DELIVERED', '#0e7490'),
        (1,2,'commit bonus · refresh challenges', '#0e7490'),
        (0,1,'POST /api/customer/orders/:id/feedback', '#0e7490'),
        (1,2,'INSERT OrderFeedback (48h window)', '#0e7490'),
    ]
    for (a, b, lbl, color) in msgs:
        x1 = col_x[a]
        x2 = col_x[b]
        s += arrow(x1, y, x2, y, lbl, color=color)
        y += 36
    return s + svg_close()

# ── Diagram 4 — Infrastructure & Scaling Roadmap ──────────────────────────

def diagram_04():
    W, H = 1800, 1100
    s = svg_open(W, H, 'Infrastructure & Scaling Roadmap')
    s += subtitle('Phase 1-4 evolution · single VPS today, horizontal scale only when revenue demands it.', 48, 84)

    phases = [
        ('p1', 'Phase 1 · Current · single VPS', 'Day 1 · 20 restaurants · 5k DAU · ~₹4 000/mo',
         [('Cloudflare', 'DNS · TLS · WAF'),
          ('nginx', 'TLS · static · gzip'),
          ('Next.js + PM2', '4 vCPU · 8 GB'),
          ('PostgreSQL 16', 'WAL archive'),
          ('Local FS', '/var/uploads'),
          ('pg_dump cron', 'Encrypted off-site')]),
        ('p2', 'Phase 2 · Growth', '100 restaurants · 50k DAU · ~₹12 000/mo',
         [('Cloudflare R2', 'S3-compat · zero egress'),
          ('Redis', 'Session · rate-limit · SSE backplane'),
          ('Next.js + R2', 'Adapter swap'),
          ('CDN', 'Image transforms')]),
        ('p3', 'Phase 3 · Scale', '1000 restaurants · 500k DAU · ~₹35 000/mo',
         [('Load balancer', 'nginx / Cloudflare LB'),
          ('2-3× Next.js boxes', 'Stateless · session in Redis'),
          ('PgBouncer', 'Connection pooling'),
          ('PG primary + replica', 'Dedicated box')]),
        ('p4', 'Phase 4 · Intelligence', '50k orders/day · ~₹85 000/mo',
         [('ML dispatch service', 'Lifted from monolith'),
          ('Analytics warehouse', 'ClickHouse / BigQuery'),
          ('Feature pipeline', 'Cron → warehouse'),
          ('Smart routing', 'Multi-stop optimizer')]),
    ]
    col_w = 405
    for i, (pal, title, sub, items) in enumerate(phases):
        x = 48 + i * (col_w + 15)
        s += group(x, 130, col_w, 920, title, pal)
        s += subtitle(sub, x + 16, 168, color=PAL[pal][1])
        for j, (name, descr) in enumerate(items):
            s += box(x + 24, 200 + j * 130, col_w - 48, 110, name, pal, sub=descr)
        # transition arrow at the bottom
        if i < len(phases) - 1:
            s += arrow(x + col_w + 4, 600, x + col_w + 12, 600, color=PAL[phases[i+1][0]][1])
    return s + svg_close()

# ── Diagram 5 — Realtime SSE ─────────────────────────────────────────────

def diagram_05():
    W, H = 1800, 1000
    s = svg_open(W, H, 'Realtime Communication — SSE channels')
    s += subtitle('Publishers → EventEmitter → channels → SSE subscribers · in-process · no Redis in Phase 1.', 48, 84)

    # Publishers (left column)
    s += group(48, 130, 360, 820, 'Publishers')
    pubs = ['placeOrder', 'transitionOrder', 'rider/ping', 'rider/pool/claim', 'admin/orders/cancel', 'escalation engine']
    for i, p in enumerate(pubs):
        s += box(80, 180 + i*120, 280, 90, p, 'pub', font_size=15)

    # EventEmitter (center)
    s += group(450, 130, 460, 820, 'Bus · src/server/realtime.ts')
    s += box(475, 350, 410, 100, 'EventEmitter', 'bus', sub='Node in-process pub/sub', font_size=18)
    # channels stacked
    chans = ['branch:X:orders', 'order:Y', 'rider:pool', 'platform:riders', 'admin:live']
    for i, c in enumerate(chans):
        s += box(475 + (i%3)*135 - 6, 480 + (i//3)*90, 130, 70, c, 'bus', font_size=12)

    # Subscribers (right column)
    s += group(950, 130, 380, 820, 'Subscribers via SSE')
    subs = ['Kitchen Panel', 'Customer tracker', 'Rider order list', 'Super-admin live map', 'Admin live orders']
    for i, p in enumerate(subs):
        s += box(980, 180 + i*140, 320, 110, p, 'sub', font_size=15)

    # Fallback
    s += group(1380, 130, 370, 820, 'Polling fallback')
    s += box(1410, 350, 310, 110, 'Polling client', 'alert', sub='setInterval 5s · If-Modified-Since', font_size=15)
    s += box(1410, 500, 310, 100, '/api/orders/:id/poll', 'alert', sub='Same shape as SSE message', font_size=15)

    # arrows
    for i in range(len(pubs)):
        s += arrow(360, 225 + i*120, 475, 400, color='#b45309')
    for i in range(len(subs)):
        s += arrow(885, 400, 980, 235 + i*140, color='#0e7490')
    s += arrow(1300, 280, 1410, 405, 'on disconnect', dashed=True)
    return s + svg_close()

# ── Diagram 6 — Order State Machine ──────────────────────────────────────

def diagram_06():
    W, H = 1900, 1200
    s = svg_open(W, H, 'Order State Machine')
    s += subtitle('Source of truth in src/server/orders.ts · invalid transitions throw OrderTransitionError', 48, 84)

    # Layout — columns by phase
    states = {
        # name: (x, y, palette)
        'PAYMENT_PENDING':           (80, 160,  'state_normal'),
        'PAYMENT_FAILED':            (80, 280,  'state_fail'),
        'RECEIVED':                  (340, 160, 'state_normal'),
        'ACCEPTED':                  (560, 160, 'state_normal'),
        'PREPARING':                 (780, 160, 'state_normal'),
        'READY':                     (1000, 160, 'state_normal'),
        'RIDER_ASSIGNED':            (1220, 160, 'state_normal'),
        'PICKED_UP':                 (1440, 160, 'state_normal'),
        'OUT_FOR_DELIVERY':          (1440, 300, 'state_normal'),
        'RIDER_REACHED_CUSTOMER':    (1440, 440, 'state_normal'),
        'DELIVERY_OTP_FAILED':       (1660, 440, 'state_fail'),
        'CUSTOMER_UNREACHABLE':      (1660, 540, 'state_fail'),
        'DELIVERED':                 (1440, 580, 'state_end'),
        'DELIVERY_FAILED':           (1220, 600, 'state_fail'),
        'CANCELLED_BY_CUSTOMER':     (80, 700,  'state_fail'),
        'CANCELLED_BY_RESTAURANT':   (340, 700, 'state_fail'),
        'CANCELLED_BY_ADMIN':        (600, 700, 'state_fail'),
        'CANCELLED':                 (80, 820,  'state_fail'),
        'REFUND_PENDING':            (860, 820, 'state_normal'),
        'REFUND_INITIATED':          (1100, 820, 'state_normal'),
        'REFUNDED':                  (1340, 820, 'state_end'),
    }
    bw, bh = 200, 60
    for name, (x, y, pal) in states.items():
        s += box(x, y, bw, bh, name, pal, font_size=12, rx=6)

    # Transitions
    trans = [
        ('PAYMENT_PENDING', 'RECEIVED', ''),
        ('PAYMENT_PENDING', 'PAYMENT_FAILED', ''),
        ('PAYMENT_FAILED', 'RECEIVED', 'retry'),
        ('PAYMENT_FAILED', 'CANCELLED', '30m'),
        ('RECEIVED', 'ACCEPTED', ''),
        ('ACCEPTED', 'PREPARING', ''),
        ('PREPARING', 'READY', ''),
        ('READY', 'RIDER_ASSIGNED', ''),
        ('RIDER_ASSIGNED', 'PICKED_UP', ''),
        ('PICKED_UP', 'OUT_FOR_DELIVERY', ''),
        ('OUT_FOR_DELIVERY', 'RIDER_REACHED_CUSTOMER', ''),
        ('RIDER_REACHED_CUSTOMER', 'DELIVERED', 'OTP OK'),
        ('RIDER_REACHED_CUSTOMER', 'DELIVERY_OTP_FAILED', ''),
        ('RIDER_REACHED_CUSTOMER', 'CUSTOMER_UNREACHABLE', ''),
        ('DELIVERY_OTP_FAILED', 'DELIVERED', 'override'),
        ('DELIVERY_OTP_FAILED', 'DELIVERY_FAILED', ''),
        ('CUSTOMER_UNREACHABLE', 'DELIVERY_FAILED', ''),
        ('OUT_FOR_DELIVERY', 'DELIVERY_FAILED', ''),
        ('DELIVERY_FAILED', 'REFUND_PENDING', ''),
        ('CANCELLED_BY_CUSTOMER', 'REFUND_PENDING', ''),
        ('CANCELLED_BY_RESTAURANT', 'REFUND_PENDING', ''),
        ('CANCELLED_BY_ADMIN', 'REFUND_PENDING', ''),
        ('REFUND_PENDING', 'REFUND_INITIATED', ''),
        ('REFUND_INITIATED', 'REFUNDED', ''),
        ('REFUND_PENDING', 'REFUNDED', 'auto'),
        ('DELIVERED', 'REFUND_PENDING', 'dispute'),
    ]
    for (a, b, lbl) in trans:
        ax, ay, _ = states[a]
        bx, by, _ = states[b]
        # connect from nearest edges
        if ax + bw <= bx:
            x1, x2 = ax + bw, bx
            y1 = ay + bh/2
            y2 = by + bh/2
        elif bx + bw <= ax:
            x1, x2 = ax, bx + bw
            y1 = ay + bh/2
            y2 = by + bh/2
        else:
            x1 = ax + bw/2
            x2 = bx + bw/2
            if ay < by:
                y1, y2 = ay + bh, by
            else:
                y1, y2 = ay, by + bh
        s += arrow(x1, y1, x2, y2, lbl)

    s += legend(48, 100, [
        ('state_normal', 'In-flight'),
        ('state_fail', 'Failure / cancel'),
        ('state_end', 'Terminal'),
    ])
    return s + svg_close()

# ── Diagram 7 — Ecosystem (hub & spoke) ──────────────────────────────────

def diagram_07():
    W, H = 1800, 1200
    s = svg_open(W, H, 'Ecosystem — Hub-and-spoke')
    s += subtitle('Order engine at the center · six ecosystems plug in as self-contained capability rings.', 48, 84)

    import math
    cx, cy = W/2, H/2 + 40
    s += circle(cx, cy, 130, "Maverick's\nFood Hub\n\nORDER ENGINE", 'hub', font_size=17)

    rings = [
        ('Customer', '#fef3e7', ['QR scan', 'Mobile PWA', 'Auto-apply offers', 'OTP login', 'Live tracking', '48h feedback']),
        ('Restaurant', '#eef2ff', ['Menu + combos', 'Offers · happy hours', 'Kitchen KOT', 'Reports + ratings', 'Coupon campaigns']),
        ('Rider', '#ecfdf5', ['Capacitor Android', 'KYC', 'Order pool', 'GPS service', 'Earnings overrides', 'COD']),
        ('Admin', '#fdf4ff', ['Super-admin portal', 'KYC approvals', 'Brand umbrellas', 'Challenges', 'Signup bonus', 'Live ops']),
        ('Payments', '#fefce8', ['Razorpay', 'COD', 'Wallet + loyalty', 'Refunds']),
        ('Notifications', '#fee2e2', ['SMS', 'Email', 'Menu alerts', 'Integration alerts']),
    ]
    n = len(rings)
    for i, (title, fill, items) in enumerate(rings):
        ang = -math.pi/2 + i * (2*math.pi/n)
        rx = cx + math.cos(ang) * 460
        ry = cy + math.sin(ang) * 380
        # cluster bubble
        bw = 280; bh = 220
        s += group(rx - bw/2, ry - bh/2, bw, bh, title)
        for j, item in enumerate(items):
            iy = ry - bh/2 + 50 + j * 28
            s += box(rx - bw/2 + 16, iy, bw - 32, 24, item, 'spoke', font_size=11)
        # line back to hub
        s += line(cx + math.cos(ang)*135, cy + math.sin(ang)*135,
                  rx - math.cos(ang)*bw/3, ry - math.sin(ang)*bh/3,
                  color='#fbbf24', sw=3)
    return s + svg_close()

# ── Diagram 8 — Live Operations Dashboard ────────────────────────────────

def diagram_08():
    W, H = 1800, 1100
    s = svg_open(W, H, 'Live Operations Dashboard — Signals → tiles → escalation')
    s += subtitle('In-process detection engine · 30-second scan · SSE-pushed alerts arrive before phones buzz.', 48, 84)

    # Sources column
    s += group(48, 130, 350, 880, 'Signal sources')
    sources = ['Order state machine', 'Rider heartbeat', 'Payment webhook', 'KYC pipeline', 'COD ledger', 'Support tickets', 'Kitchen panel']
    for i, src in enumerate(sources):
        s += box(80, 180 + i*110, 290, 80, src, 'src', font_size=15)

    # Detection
    s += group(430, 130, 360, 880, 'Detection engine')
    detect = ['Stuck-order >20m', 'Rider silent >60s', 'Payment failure spike', 'Restaurant pause auto-detect']
    for i, d in enumerate(detect):
        s += diamond(610, 230 + i*200, 280, 100, d, 'esc')

    # Dashboard tiles
    s += group(820, 130, 480, 880, 'Live Ops dashboard tiles')
    tiles = [
        ('Delayed orders', '13', 'alert'),
        ('Riders online', '87/120', 'warn'),
        ('No rider assigned', '4', 'alert'),
        ('COD pending', '₹12,400', 'warn'),
        ('Payment failures', '2', 'alert'),
        ('Restaurants paused', '1', 'alert'),
        ('Support tickets', '6', 'warn'),
        ('Kitchen delays', '3', 'warn'),
    ]
    for i, (name, val, pal) in enumerate(tiles):
        x = 850 + (i%2) * 220
        y = 180 + (i//2) * 200
        s += box(x, y, 200, 170, name + '\n\n' + val, pal, font_size=14)

    # Escalation
    s += group(1330, 130, 420, 880, 'Escalation engine')
    esc = ['Auto-reassign rider', 'Page on-call admin', 'Email super admin', 'Slack webhook']
    for i, e in enumerate(esc):
        s += box(1360, 250 + i*180, 360, 110, e, 'esc', font_size=16)

    # connector arrows (representative)
    for i in range(len(sources)):
        s += arrow(370, 220 + i*110, 470, 280, color='#7c3aed')
    for i in range(len(detect)):
        s += arrow(750, 230 + i*200, 850, 400, color='#7c3aed')
    s += arrow(1300, 500, 1360, 500, color='#dc2626')
    return s + svg_close()

# ── Diagram 9 — Multi-tenant Architecture ────────────────────────────────

def diagram_09():
    W, H = 1800, 1100
    s = svg_open(W, H, 'Multi-tenant Architecture — Brand → Restaurant → Branch')
    s += subtitle('Row-level isolation · shared platform infrastructure · zero per-tenant migrations.', 48, 84)

    # Shared platform at top
    s += group(48, 130, 1704, 130, 'Shared platform · single instance')
    s += box(80, 160, 540, 80, 'Next.js · Postgres · SSE · auth', 'data', sub='Single deployable serving all tenants')
    s += box(680, 160, 540, 80, 'Super admin portal', 'data', sub='Brand mgmt · KYC · reconciliation')
    s += box(1280, 160, 440, 80, 'Audit + notification + error logs', 'data', sub='Append-only platform-wide')

    # Brand boundary
    s += group(48, 290, 1300, 730, 'Tenant boundary · Brand: Maverick Hospitality')
    s += box(110, 320, 480, 70, 'Brand: Maverick Hospitality', 'p3', sub='logo · contact · status · ownerUserId', font_size=18)

    # Cuisines
    cuisines = ['Italia Pizza', 'Biryani Zone', 'Bowl and Barbeque', 'Hotel Siddhartha', 'Wok and Sizzler', 'Party Place', 'Cuisine of Andhra']
    s += group(80, 410, 1240, 130, 'Cuisine concepts · Restaurant rows')
    for i, c in enumerate(cuisines):
        s += box(110 + i*170, 450, 158, 70, c, 'cuisine', font_size=13)

    # Branches
    branches = ['Koramangala', 'Indiranagar', 'HSR Layout']
    s += group(80, 560, 600, 130, 'Branches · physical kitchens')
    for i, b in enumerate(branches):
        s += box(110 + i*200, 600, 180, 70, b, 'branch', font_size=14)

    # Tenant-scoped data
    data_groups = ['Menus + combos', 'Offers + happy hours', 'KYC riders', 'Orders + COD', 'Feedback']
    s += group(80, 710, 1240, 290, 'Tenant-scoped data')
    for i, d in enumerate(data_groups):
        s += box(110 + (i%3)*410, 760 + (i//3)*120, 380, 100, d, 'leaf', font_size=15)

    # Solo tenants (right column)
    s += group(1370, 290, 380, 730, 'Solo restaurants · brandId = NULL')
    s += box(1400, 340, 320, 80, 'Solo Restaurant A', 'cuisine', sub='Standalone, no brand grouping')
    s += box(1400, 440, 320, 80, 'Solo Restaurant B', 'cuisine', sub='Reports stay at the restaurant level')
    s += box(1400, 560, 320, 220, 'Same shared platform\nNo schema branching\nNo per-tenant migrations', 'data', font_size=14)

    return s + svg_close()

# ── Diagram 10 — Journey Map (composite) ─────────────────────────────────

def diagram_10():
    W, H = 1900, 1200
    s = svg_open(W, H, 'Mobile + Web Experience Journey Map')
    s += subtitle('Four roles, one shared realtime backbone. Each row reads left-to-right as a moment in time.', 48, 84)

    journeys = [
        ('Customer', 'client', [
            ('Discover', 'Scan QR · land on /r/[slug]'),
            ('Browse', 'Menu with happy-hour prices · cross-sell strips'),
            ('Decide', 'Auto-apply offer · signup bonus appears'),
            ('Pay', 'OTP login → Razorpay UPI or COD'),
            ('Track', 'SSE status · rider GPS pin · delivery OTP'),
            ('Feedback', '48h CTA · stars · tags · optional photo'),
        ]),
        ('Rider', 'app', [
            ('Onboard', 'Self-register + KYC · super-admin approval'),
            ('Start shift', 'Go ONLINE on home screen'),
            ('Claim', 'Order pool with payout preview'),
            ('Pickup', 'Navigate · mark reached · photo proof'),
            ('Deliver', 'GPS pings · geofence · OTP delivered'),
            ('Earn', 'Earnings card updates · EOD payout'),
        ]),
        ('Restaurant', 'edge', [
            ('Receive', 'SSE new-order tile'),
            ('Review', 'Items + customer notes'),
            ('Prepare', 'KOT with combo breakdown · mark prepared'),
            ('Ready', 'Pool publishes to riders'),
            ('Handoff', 'Rider arrives · picks up'),
            ('Reflect', 'Feedback in drawer · low-rated drilldown'),
        ]),
        ('Super-admin', 'ext', [
            ('Monitor', 'Live ops dashboard · KYC queue'),
            ('Manage', 'Live map · payout overrides'),
            ('Govern', 'Pause restaurant · approve riders'),
            ('Promote', 'Coupon campaigns · QR posters'),
            ('Configure', 'Signup bonus · challenges'),
            ('Reflect', 'Brand rollups · feedback heatmap · audit'),
        ]),
    ]
    col_w = (W - 96 - 200) / 6
    for row, (actor, pal, steps) in enumerate(journeys):
        y = 130 + row * 240
        s += box(48, y + 50, 180, 110, actor, pal, font_size=20)
        for i, (label, body) in enumerate(steps):
            x = 248 + i * col_w
            s += box(x, y + 40, col_w - 30, 60, label, pal, font_size=15)
            s += box(x, y + 110, col_w - 30, 60, body, 'leaf', font_size=11)
            if i < len(steps) - 1:
                s += arrow(x + col_w - 30, y + 70, x + col_w + 2, y + 70)
    return s + svg_close()

# ── Driver ─────────────────────────────────────────────────────────────────

DIAGRAMS = [
    ('01-technical-architecture', diagram_01),
    ('02-business-architecture',  diagram_02),
    ('03-data-flow',              diagram_03),
    ('04-infrastructure-scaling', diagram_04),
    ('05-realtime-sse',           diagram_05),
    ('06-order-state-machine',    diagram_06),
    ('07-ecosystem',              diagram_07),
    ('08-live-ops',               diagram_08),
    ('09-multi-tenant',           diagram_09),
    ('10-journey-map',            diagram_10),
]

def main():
    for name, fn in DIAGRAMS:
        svg = fn()
        svg_path = os.path.join(OUT, f'{name}.svg')
        with open(svg_path, 'w') as f:
            f.write(svg)
        png_path = os.path.join(OUT, f'{name}.png')
        try:
            cairosvg.svg2png(
                bytestring=svg.encode('utf-8'),
                write_to=png_path,
                output_width=2400,   # high DPI for crisp screen / print
                background_color='white',
            )
            print(f'  ✓ {name}.png')
        except Exception as e:
            print(f'  ✗ {name}: {e}', file=sys.stderr)

if __name__ == '__main__':
    main()

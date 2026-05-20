#!/usr/bin/env python3
"""
Generate the platform's architecture/flow diagrams as SVG + PNG into docs/.
Run: python3 docs/gen-diagrams.py   (needs `cairosvg`)
"""
import os, html, cairosvg
OUT = os.path.dirname(os.path.abspath(__file__))

BG="#FAF7F2"; INK="#1F2937"; MUT="#6B7280"; LINE="#D8D2C7"; CARD="#FFFFFF"
PRIMARY="#EA580C"; PRIMARY_T="#FCE7DA"; BLUE="#2563EB"; BLUE_T="#E0EAFF"
GREEN="#15803D"; GREEN_T="#DCFCE7"; PURPLE="#7C3AED"; PURPLE_T="#EDE4FF"
AMBER="#B45309"; AMBER_T="#FCEFD6"; SLATE="#334155"; SLATE_T="#E5E9F0"
FONT="Helvetica, Arial, sans-serif"

def esc(s): return html.escape(str(s), quote=True)
def text(x,y,s,size=15,weight="400",fill=INK,anchor="start",italic=False):
    st="italic" if italic else "normal"
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'font-style="{st}" fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')
def box(x,y,w,h,title,lines=None,fill=CARD,stroke=LINE,tcol=INK,sub=None,rx=12,title_size=16):
    out=[f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>']
    cx=x+w/2; ty=y+(26 if (lines or sub) else h/2+5)
    out.append(text(cx,ty,title,title_size,"700",tcol,"middle"))
    if sub: out.append(text(cx,ty+18,sub,12.5,"400",MUT,"middle"))
    if lines:
        ly=ty+(34 if sub else 24)
        for ln in lines: out.append(text(x+16,ly,"• "+ln,12.5,"400",MUT,"start")); ly+=18
    return "".join(out)
def container(x,y,w,h,title,col,colt):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{colt}" stroke="{col}" stroke-width="1.5"/>'
            + text(x+18,y+26,title,14,"700",col))
def chip(x,y,w,label,fill,tcol,h=30):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{fill}"/>'
            + text(x+w/2,y+h/2+4,label,12.5,"600",tcol,"middle"))
def arrow(x1,y1,x2,y2,color=SLATE,dashed=False,label=None,lsize=11,loff=-6):
    dash=' stroke-dasharray="5 5"' if dashed else ''
    seg=f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="2"{dash} marker-end="url(#ar)"/>'
    if label:
        mx,my=(x1+x2)/2,(y1+y2)/2
        seg+=f'<rect x="{mx-len(label)*3.4-6}" y="{my+loff-12}" width="{len(label)*6.8+12}" height="18" rx="9" fill="{BG}" opacity="0.95"/>'
        seg+=text(mx,my+loff+1,label,lsize,"600",color,"middle")
    return seg
def svg_open(w,h,title,subtitle):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 0L10 5L0 10z" fill="{SLATE}"/></marker></defs>'
            f'<rect width="{w}" height="{h}" fill="{BG}"/><rect x="0" y="0" width="{w}" height="64" fill="{INK}"/>'
            + text(36,34,title,24,"800","#FFFFFF","start") + text(36,53,subtitle,13,"400","#C9CDD6","start")
            + text(w-36,40,"Reshee Tech",16,"700",PRIMARY,"end") + text(w-36,55,"Multi-tenant food delivery platform",11,"400","#C9CDD6","end"))
def render(name, body, w, h):
    svg=body+"</svg>"
    open(os.path.join(OUT,name+".svg"),"w").write(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT,name+".png"), output_width=w*2, output_height=h*2)
    print("wrote", name+".png")

def system_architecture():
    W,H=1680,1040; s=[svg_open(W,H,"System Architecture","Clients → Next.js app → data + realtime → external services → hosting")]
    s.append(text(40,98,"CLIENTS",13,"700",MUT)); cw=300
    s.append(box(40,112,cw,86,"Customer Web","Discovery · menu · cart · checkout · live tracking".split(" · ")))
    s.append(box(360,112,cw,86,"Restaurant Admin + Kitchen","Orders board · KOT · menu · settings".split(" · ")))
    s.append(box(680,112,cw,86,"Super-Admin Platform","Network ops · approvals · payouts · KYC".split(" · ")))
    s.append(box(1000,112,cw,86,"Rider App (Android)","Expo · OTP · pool · GPS · proof".split(" · ")))
    s.append(box(1320,112,320,86,"Public Storefront","SEO pages · /r/[slug] menus".split(" · ")))
    for cx in (190,510,830,1150,1480): s.append(arrow(cx,198,cx,250,SLATE))
    s.append(text(40,236,"APPLICATION  ·  Next.js 15 App Router (TypeScript)",13,"700",MUT))
    s.append(f'<rect x="40" y="250" width="1600" height="150" rx="14" fill="{PRIMARY_T}" stroke="{PRIMARY}" stroke-width="1.5"/>')
    s.append(text(60,278,"Route-grouped surfaces",13,"700",PRIMARY))
    for i,t in enumerate(["(customer)","admin","kitchen","platform","login / qr"]): s.append(chip(60+i*150,292,138,t,CARD,PRIMARY))
    s.append(text(60,348,"Edge: middleware (auth gate) · Node: Server Components + Server Actions + REST/SSE API (/api/*)",12.5,"500",SLATE))
    s.append(text(60,372,"Server modules: tenancy · group-scope · orders (state machine) · realtime (SSE bus) · pricing · offers · auth/sessions",12.5,"500",SLATE))
    s.append(arrow(300,400,300,452,SLATE,label="Prisma")); s.append(arrow(840,400,840,452,SLATE,label="publish/subscribe")); s.append(arrow(1380,400,1380,452,SLATE,label="adapters"))
    s.append(container(40,452,520,162,"Data Layer",SLATE,SLATE_T))
    s.append(box(60,486,232,116,"PostgreSQL",["Restaurants, branches, menu","Orders, items, payments","Users, sessions, addresses"],title_size=14))
    s.append(box(308,486,232,116,"Prisma ORM",["Type-safe client","Schema + db push","Migrations"],title_size=14))
    s.append(container(580,452,520,162,"Realtime",BLUE,BLUE_T))
    s.append(box(600,486,480,116,"EventEmitter SSE bus",["branch:{id}:orders","group:{root}:orders","rider:pool · order:{id}"],sub="GET /api/events + poll + 15s snapshot",title_size=14))
    s.append(container(1120,452,520,162,"External (adapter + mock)",GREEN,GREEN_T))
    exts=["Razorpay (pay+webhook)","2Factor SMS / OTP","Google OAuth","OpenStreetMap / Leaflet","S3 storage","Expo push (rider)"]
    for i,e in enumerate(exts): s.append(chip(1140+(i%2)*250,486+(i//2)*38,234,e,CARD,GREEN))
    s.append(arrow(300,614,300,654,SLATE)); s.append(arrow(840,614,840,654,SLATE)); s.append(arrow(1380,614,1380,654,SLATE))
    s.append(text(40,646,"HOSTING  ·  Hostinger VPS",13,"700",MUT))
    s.append(f'<rect x="40" y="660" width="1600" height="86" rx="14" fill="{CARD}" stroke="{LINE}" stroke-width="1.5"/>')
    for i,t in enumerate(["nginx (TLS, reverse proxy, SSE flush)","PM2 — rm-web (Node 20, fork)","PostgreSQL 15","GitHub deploy (scripts/deploy.sh)"]): s.append(chip(64+i*392,692,372,t,SLATE_T,SLATE,h=34))
    s.append(text(40,790,"AUTH MODEL",13,"700",MUT))
    s.append(f'<rect x="40" y="804" width="1600" height="86" rx="14" fill="{PURPLE_T}" stroke="{PURPLE}" stroke-width="1.5"/>')
    for i,t in enumerate(["NextAuth v5 (JWT)","Phone OTP — customers/riders","Email+Argon2id — staff","Single active session","Super-admin TOTP + IP allowlist"]): s.append(chip(64+i*316,836,300,t,CARD,PURPLE,h=34))
    s.append(text(40,932,"MULTI-TENANCY",13,"700",MUT))
    s.append(f'<rect x="40" y="946" width="1600" height="70" rx="14" fill="{AMBER_T}" stroke="{AMBER}" stroke-width="1.5"/>')
    s.append(text(64,986,"Restaurant = tenant → branches.  Parent⇄child groups: a parent operates the whole group (orders, riders, reports) via group-scope + account switcher.",13,"500",SLATE))
    render("system-architecture-v2","".join(s),W,H)

def technical_architecture():
    W,H=1680,1020; s=[svg_open(W,H,"Technical Architecture","Layered view — surfaces, server modules, data, infra")]
    def layer(y,title,col,colt,items,h=128):
        s.append(f'<rect x="40" y="{y}" width="1600" height="{h}" rx="14" fill="{colt}" stroke="{col}" stroke-width="1.5"/>')
        s.append(text(60,y+28,title,15,"700",col)); n=len(items); bw=(1600-40-(n-1)*16)/n
        for i,(t,sub) in enumerate(items): s.append(box(60+i*(bw+16),y+44,bw,h-60,t,None,CARD,LINE,sub=sub,title_size=14))
    layer(88,"PRESENTATION — route groups + client components",PRIMARY,PRIMARY_T,
          [("(customer)","menu·cart·checkout·track"),("admin","orders·menu·settings"),("kitchen","KOT board"),("platform","super-admin"),("rider-native","Expo app")])
    s.append(arrow(840,216,840,250,SLATE))
    layer(252,"API — /api route handlers (REST + SSE)",BLUE,BLUE_T,
          [("orders / checkout","placeOrder, transitions"),("admin/*","tenant-scoped CRUD"),("rider/*","Bearer JWT"),("events","SSE + poll"),("payments/webhook","Razorpay verify")])
    s.append(arrow(840,380,840,414,SLATE))
    layer(416,"DOMAIN — server/* modules (business logic)",PURPLE,PURPLE_T,
          [("tenancy / group-scope","active restaurant, groups"),("orders","state machine + events"),("pricing engines","happy-hour·offers·variants"),("auth / sessions","NextAuth + single-session"),("notifications","SMS/OTP, chimes")])
    s.append(arrow(840,544,840,578,SLATE))
    layer(580,"INTEGRATION — provider adapters (swappable, mock-by-default)",GREEN,GREEN_T,
          [("payments","Razorpay / COD / wallet"),("sms","2Factor / Fast2SMS"),("storage","local / S3"),("maps","OSM / Leaflet"),("push","Expo")])
    s.append(arrow(840,708,840,742,SLATE))
    layer(744,"DATA & INFRA",SLATE,SLATE_T,
          [("PostgreSQL + Prisma","schema, db push"),("EventEmitter bus","in-process realtime"),("nginx + PM2","VPS, Node 20"),("GitHub + deploy.sh","push→build→restart"),("Vitest + Playwright","403 unit + E2E")])
    s.append(text(60,1000,"Cross-cutting: feature flags · audit log · OTP rate-limits · server-authoritative pricing · Decimal→Number at the boundary · force-dynamic on per-user pages",12.5,"500",MUT))
    render("technical-architecture-v2","".join(s),W,H)

def data_flow():
    W,H=1680,940; s=[svg_open(W,H,"Data Flow — Place Order","From customer checkout to live kitchen / admin / rider updates")]
    s.append(box(40,110,250,80,"Customer",None,CARD,LINE,sub="cart + checkout",title_size=16))
    s.append(arrow(290,150,360,150,BLUE,label="POST /api/orders"))
    s.append(box(360,110,300,80,"orders API",None,BLUE_T,BLUE,sub="zod-validated body",title_size=15))
    s.append(arrow(660,150,730,150,SLATE,label="placeOrder()"))
    s.append(container(730,96,910,200,"placeOrder (server-authoritative)",PURPLE,PURPLE_T))
    steps=["resolve menu items + variants/modifiers","apply happy-hour, offers, coupons, wallet, loyalty","fulfillment: delivery / pickup / dine-in / scheduled","freebie grant (atomic stock decrement)","price + tax + delivery fee → totals","create Order + items in one transaction"]
    for i,t in enumerate(steps): s.append(text(752,138+i*25,f"{i+1}. {t}",13,"500",SLATE))
    s.append(arrow(1185,296,1185,348,SLATE,label="commit"))
    s.append(box(980,348,420,72,"PostgreSQL",None,CARD,LINE,sub="Order = RECEIVED",title_size=15))
    s.append(arrow(980,384,722,384,SLATE,label="publish"))
    s.append(container(360,348,360,150,"Realtime SSE bus",BLUE,BLUE_T))
    for i,t in enumerate(["branch:{id}:orders","group:{root}:orders","order:{id}  ·  rider:pool"]): s.append(text(384,398+i*26,t,13,"600",BLUE))
    s.append(arrow(540,498,540,556,SLATE))
    s.append(box(360,556,360,80,"Kitchen board",None,GREEN_T,GREEN,sub="New → Preparing → Ready",title_size=15))
    s.append(arrow(820,420,840,556,SLATE,dashed=True))
    s.append(box(760,556,360,80,"Admin orders",None,GREEN_T,GREEN,sub="group-wide, labelled",title_size=15))
    s.append(arrow(1300,420,1300,556,SLATE,dashed=True,label="on READY"))
    s.append(box(1160,556,420,80,"Rider pool → assignment",None,GREEN_T,GREEN,sub="push + claim, GPS",title_size=15))
    s.append(f'<rect x="40" y="676" width="1600" height="72" rx="14" fill="{AMBER_T}" stroke="{AMBER}" stroke-width="1.5"/>')
    s.append(text(64,704,"Sync safety net",14,"700",AMBER))
    s.append(text(64,728,"SSE is the fast path; every board also polls a snapshot every 15s + on tab-focus, so an order is never invisible even if the live stream drops.",12.5,"500",SLATE))
    s.append(f'<rect x="40" y="766" width="1600" height="138" rx="14" fill="{CARD}" stroke="{LINE}" stroke-width="1.5"/>')
    s.append(text(64,794,"Order state machine",14,"700",INK))
    states=["PAYMENT_PENDING","RECEIVED","ACCEPTED","PREPARING","READY","OUT_FOR_DELIVERY","DELIVERED"]; bw=196
    for i,st in enumerate(states):
        x=64+i*(bw+14)
        if x+bw>1620: break
        s.append(chip(x,820,bw,st,SLATE_T,SLATE,h=34))
        if i<len(states)-1 and (64+(i+1)*(bw+14))+bw<=1620: s.append(arrow(x+bw,837,x+bw+14,837,SLATE))
    s.append(text(64,884,"+ failure / recovery: PAYMENT_FAILED · DELIVERY_OTP_FAILED · CUSTOMER_UNREACHABLE · CANCELLED_BY_* · REFUND_*",12,"500",MUT))
    render("data-flow-v2","".join(s),W,H)

def integrations():
    W,H=1680,940; s=[svg_open(W,H,"Third-Party Integrations","Every external service sits behind a swappable adapter with a mock default")]
    s.append(box(640,110,400,150,"Reshee Tech",["server/* adapter interfaces","mock impl for local dev","real keys at deploy time"],PRIMARY_T,PRIMARY,tcol=PRIMARY))
    items=[("Razorpay",BLUE,BLUE_T,"Payments","create order · capture · webhook (signature verify)"),
      ("2Factor",GREEN,GREEN_T,"SMS / OTP","login + delivery OTP (India); MSG91/Fast2SMS alt"),
      ("Google OAuth",AMBER,AMBER_T,"Customer sign-in","NextAuth provider; email→customer provisioning"),
      ("OpenStreetMap",PURPLE,PURPLE_T,"Maps (free)","Leaflet tiles · address picker · live rider GPS"),
      ("S3-compatible",SLATE,SLATE_T,"Object storage","menu / KYC images via storage adapter"),
      ("Expo Push",BLUE,BLUE_T,"Rider notifications","new-order push to the native Android app")]
    pos=[(120,360),(640,360),(1160,360),(120,610),(640,610),(1160,610)]; cx,cy=840,260
    for (name,col,colt,role,desc),(x,y) in zip(items,pos):
        s.append(arrow(cx,cy,x+200,y,col,dashed=True))
        s.append(box(x,y,400,118,name,None,colt,col,tcol=col,sub=role,title_size=17))
        s.append(text(x+200,y+90,desc,11.5,"500",SLATE,"middle"))
    s.append(f'<rect x="40" y="772" width="1600" height="120" rx="14" fill="{CARD}" stroke="{LINE}" stroke-width="1.5"/>')
    s.append(text(64,802,"Why adapters",14,"700",INK))
    s.append(text(64,828,"Each integration is reached through a narrow interface, so local/dev runs fully on mocks (no keys, no spend) and production swaps in real",12.5,"500",SLATE))
    s.append(text(64,850,"credentials via env. A provider can be replaced (e.g. 2Factor → MSG91) without touching call sites; failures are best-effort and never roll back a paid order.",12.5,"500",SLATE))
    s.append(text(64,878,"Config: DATABASE_URL · NEXTAUTH_SECRET · RAZORPAY_* · 2FACTOR_* · GOOGLE_CLIENT_* · STORAGE_DRIVER / S3_* · NEXT_PUBLIC_BRAND_NAME",12,"600",MUT))
    render("integrations-v2","".join(s),W,H)

def end_to_end():
    W,H=1860,940; s=[svg_open(W,H,"End-to-End Order Flow","Swimlanes across customer, system, kitchen, admin and rider")]
    lanes=[("CUSTOMER",PRIMARY,PRIMARY_T),("SYSTEM",BLUE,BLUE_T),("KITCHEN",GREEN,GREEN_T),("ADMIN",AMBER,AMBER_T),("RIDER",PURPLE,PURPLE_T)]
    top=96; lh=150
    for i,(nm,col,colt) in enumerate(lanes):
        y=top+i*lh
        s.append(f'<rect x="40" y="{y}" width="1780" height="{lh-12}" rx="12" fill="{colt}" opacity="0.5"/>')
        s.append(f'<rect x="40" y="{y}" width="150" height="{lh-12}" rx="12" fill="{col}"/>')
        s.append(text(115,y+(lh-12)/2,nm,13,"800","#FFFFFF","middle"))
    def node(col,row,label,sub=None):
        x=210+col*250; y=top+row*lh+(lh-12)/2-32; s.append(box(x,y,224,64,label,None,CARD,LINE,sub=sub,title_size=13.5))
    def cxy(col,row): return (210+col*250+112, top+row*lh+(lh-12)/2)
    node(0,0,"Login / discover","near-me restaurants"); node(1,0,"Pick restaurant","/r/[slug] menu"); node(2,0,"Build cart","variants + add-ons"); node(3,0,"Checkout","delivery/pickup/dine-in")
    node(0,1,"Validate + price","server-authoritative"); node(1,1,"Payment","Razorpay / COD"); node(2,1,"Create order","RECEIVED + SSE")
    node(2,2,"Accept → Prepare","KOT, prep timer"); node(3,2,"Mark READY")
    node(0,3,"Auto-accept?","restaurant setting"); node(1,3,"Live monitor","group-wide board")
    node(0,4,"Dispatch to pool","push online riders"); node(1,4,"Claim + pickup","GPS streaming"); node(2,4,"Deliver + OTP","proof-of-delivery")
    seq=[((0,0),(1,0)),((1,0),(2,0)),((2,0),(3,0)),((3,0),(0,1)),((0,1),(1,1)),((1,1),(2,1)),((2,1),(2,2)),((2,2),(3,2)),((3,2),(0,3)),((0,3),(0,4)),((0,4),(1,4)),((1,4),(2,4))]
    for a,b in seq:
        ax,ay=cxy(*a); bx,by=cxy(*b)
        if a[1]==b[1]: s.append(arrow(ax+112,ay,bx-112,by,SLATE))
        else: s.append(arrow(ax,ay+34,bx,by-34,SLATE,dashed=True))
    s.append(text(40,H-26,"Customer also tracks status + rider location live; admin can reassign; failures route to recovery states (OTP fail, unreachable, refund).",12.5,"500",MUT))
    render("end-to-end-flow-v2","".join(s),W,H)

system_architecture(); technical_architecture(); data_flow(); integrations(); end_to_end(); print("DONE")

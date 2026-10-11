import json, re, html, subprocess
spec=json.load(open("repo/api/openapi.json"))
seed=open("crm-docs/db/seed.sql").read()
grants={}
for r,p in re.findall(r"\('(\w+)','([a-z_]+\.[a-z_]+)'\)",seed): grants.setdefault(p,[]).append(r)
RN={"director":"Director","general_manager":"GM","sales_manager":"Sales Mgr","team_leader":"Team Leader","sales_agent":"Agent","admin":"Admin","finance":"Finance"}
ALL=["director","general_manager","sales_manager","team_leader","sales_agent","admin","finance"]
def who(perm):
    if not perm: return "Public / outside system"
    if perm.startswith("("):
        return {"(any signed-in user)":"Everyone","(own)":"Everyone (own data)","(owner)":"Everyone (own)","(uploader)":"Everyone","(record access)":"Anyone who can see the record","(edit access to the record)":"Anyone who can edit the record","(own tasks; managers within scope)":"Everyone (own); managers for their teams"}.get(perm,("Our team: "+perm.strip("()").split(": ")[1]) if perm.startswith("(platform") else perm.strip("()"))
    rs=grants.get(perm,[])
    if set(rs)==set(ALL): return "Everyone"
    if set(rs)==set(ALL)-{"finance"}: return "All except Finance"
    return ", ".join(RN[r] for r in ALL if r in rs) or "Admin (custom roles can be given it)"
INTRO={
"Session":"Who is logged in, what they may do, and the search box on every screen.",
"Organization":"Company profile, users, teams, divisions and roles. Admin switches lead assignment on/off per user and creates custom roles (Sales, Basic, HR…).",
"Settings":"The lists and rules the company can change itself: stages, reasons, lead sources, currencies and response time.",
"Leads":"Everything about a buyer: create, list by tab, the lead page and timeline, notes and calls, stage changes, assignment, sharing with colleagues, import from Excel, and re-enquiries.",
"Assignment":"Rules that decide which agent gets each new lead (by project, campaign, source, language, location; round-robin).",
"Marketing":"Ad campaigns, daily ad spend and events/roadshows, used for cost-per-lead reports.",
"Tasks":"Calls, follow-ups and personal tasks with reminders. Completing a call records the outcome and the next action.",
"Meetings":"Online meetings (Google Meet / Teams) and viewings, free-slot checks, and each agent's booking page settings. Double booking is blocked.",
"Public booking":"The client-facing booking page. No login needed; protected against bots.",
"Messaging":"WhatsApp and email conversations, templates, bulk campaigns with manager approval, and consent / opt-out.",
"Projects":"Developers, projects, buildings and units with status and price history.",
"Deals":"A buyer's purchase of a unit: offer → EOI → booking → sold. Updates unit status automatically.",
"Finance":"Invoices and purchase orders (draft → approve → send), payments, refunds and commissions.",
"Attendance":"Phone check-in/out with photo, corrections with manager approval, leave, holidays and office-hour policies.",
"Dashboard":"Number cards and charts for each role; every number opens the leads behind it.",
"Reports":"All reports, Excel/CSV exports (Admin only, all logged) and Meta lead reconciliation.",
"Integrations":"Connecting Meta, portals, WhatsApp, Google, Microsoft and the general webhook; status, failures and retry.",
"Files":"Uploading and downloading files securely (brochures, photos, invoices).",
"Notifications":"In-app and phone notifications.",
"Audit":"The tamper-proof log of who changed what.",
"Public sign-up":"Our pricing page and online sign-up: a new agent or brokerage picks a plan, enters RERA / licence details, verifies email, saves a card and starts a 14-day free trial. Enterprise customers contact sales.",
"Subscription & billing":"For the company's Admin: plan, seats, monthly or yearly, card or bank transfer, our VAT invoices, cancellation and full data export.",
"Owner console":"Private screens for our own team only: all customer companies, income, trials, licence checks, bank transfer confirmation, plans and prices, suspend or extend.",
"Webhooks (inbound)":"Addresses where outside systems send us data: Meta, WhatsApp, Property Finder, Bayut, Dubizzle, the general webhook, portal emails, calendars and Stripe payments.",
}
COLOR=["#0d9488","#3b6fe0","#8b5cf6","#e39a00","#1f9d63","#c0362c","#0f3b45","#b7791f"]
MC={"get":"#2563eb","post":"#16a34a","put":"#b7791f","patch":"#9333ea","delete":"#dc2626"}
VERB={"get":"View","post":"Do","put":"Set","patch":"Edit","delete":"Remove"}
e=html.escape
by={}
for p,ms in spec["paths"].items():
    for m,o in ms.items(): by.setdefault(o["tags"][0],[]).append((m,p,o))
total=sum(len(v) for v in by.values())
secs=""; toc=""
for i,t in enumerate([x["name"] for x in spec["tags"]]):
    c=COLOR[i%len(COLOR)]
    rows="".join(f'<tr><td><span class="m" style="background:{MC[m]}">{m.upper()}</span></td><td class="p">{e(p)}</td><td>{e(o["summary"])}</td><td class="w">{e(who(o.get("x-permission")))}</td></tr>' for m,p,o in by[t])
    toc+=f'<tr><td><b>{e(t)}</b></td><td class="n">{len(by[t])}</td><td>{e(INTRO[t])}</td></tr>'
    secs+=f'<section><h3 style="border-color:{c}"><span>{e(t)}</span><small>{len(by[t])} APIs</small></h3><p class="in">{e(INTRO[t])}</p><table class="ep"><thead><tr><th></th><th>Address</th><th>What it does</th><th>Who can use it</th></tr></thead><tbody>{rows}</tbody></table></section>'
guide=open("repo/docs/05-API-Guide.md").read()
fm=guide[guide.index("| SRS feature (v1.2) |"):guide.index("\n## 11. Endpoints by section")]
fmh=subprocess.run(["pandoc","-f","gfm","-t","html","--wrap=none"],input=fm,capture_output=True,text=True).stdout
codes=guide[guide.index("| Code | When |"):guide.index("\n## 7. Files")]
codesh=subprocess.run(["pandoc","-f","gfm","-t","html","--wrap=none"],input=codes,capture_output=True,text=True).stdout
page=f'''<!doctype html><meta charset="utf-8"><title>CRM API Overview</title>
<style>
@page{{size:A4;margin:10mm 10mm 12mm}}
:root{{--ink:#16232b;--muted:#5d6d78;--line:#e1e7ea;--accent:#0d8a80;--soft:#e3f5f2}}
*{{box-sizing:border-box}} body{{margin:0;color:var(--ink);font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:9.5px;line-height:1.38;background:#fff;padding-inline:0}}
h1{{font-size:22px;margin:0 0 2px;letter-spacing:-.01em}} .sub{{color:var(--muted);margin:0 0 8px;font-size:10px}}
h2{{font-size:13.5px;margin:12px 0 5px;color:var(--accent)}}
h3{{display:flex;align-items:baseline;gap:8px;font-size:12.5px;margin:9px 0 2px;border-left:4px solid;padding-left:7px}} h3 small{{color:var(--muted);font-weight:400;font-size:9.5px}}
p{{margin:3px 0}} .in{{color:#36505b;margin:0 0 4px}}
table{{border-collapse:collapse;width:100%;font-size:9px}} td{{font-size:inherit}} .ep td{{font-size:8.8px}} .toc td{{font-size:9.2px}} th,td{{padding:2.5px 5px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
th{{font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}}
.ep td.p{{font-family:Menlo,Consolas,monospace;font-size:8.6px;white-space:nowrap}} .ep td.w{{color:#36505b;width:22%}}
.m{{display:inline-block;color:#fff;font:700 7.5px Menlo,Consolas,monospace;border-radius:3px;padding:1px 4px;min-width:38px;text-align:center}}
.ep tr{{break-inside:avoid}} section{{break-inside:auto}} h3{{break-after:avoid}}
.grid{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:6px 0}}
.box{{border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:#fafcfc}} .box b{{display:block;font-size:10px;margin-bottom:2px;color:var(--accent)}}
.flow{{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:6px 0;font-size:9.5px}} .flow span{{background:var(--soft);border:1px solid #9fd9d1;border-radius:5px;padding:3px 7px;font-weight:700;color:#0d5c55}} .flow i{{color:var(--accent);font-style:normal;font-weight:800}}
.flow span.o{{background:#fff1d6;border-color:#ffd38a;color:#7a4b00}} .flow span.b{{background:#e1ecff;border-color:#b8cdf7;color:#1f4fbf}}
.toc td.n{{text-align:right;font-weight:700;width:30px}} .toc td:first-child{{width:120px}}
.fm table td:first-child{{width:30%}} .fm table code,.cd code{{font-family:Menlo,Consolas,monospace;font-size:8.4px}}
.fm table{{font-size:9px}} .cd table{{font-size:9px}}
.kp{{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0}} .kp div{{border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:6px;padding:5px 8px}} .kp b{{font-size:16px;display:block}} .kp small{{color:var(--muted)}}
</style>
<h1>API overview</h1>
<p class="sub">Dubai Real Estate CRM · Document 05 · Version 1.2 · 11 October 2026 · For stakeholders and developers · Full technical details: Swagger (api/openapi.yaml)</p>
<div class="kp"><div><b>{total}</b><small>APIs</small></div><div><b>{len(by)}</b><small>modules</small></div><div><b>100%</b><small>of SRS v1.2 features covered</small></div><div><b>UAE</b><small>all data stays in the UAE</small></div></div>
<h2>What an API is, in simple words</h2>
<p>The <b>API</b> is the CRM's "front desk". The screens on computers and phones never touch the database directly: they ask the API, and the API checks who you are and what you are allowed to do before it reads or changes anything. Outside systems (Meta ads, WhatsApp, Property Finder, Bayut, Dubizzle, the website) also hand new leads to the API.</p>
<div class="flow"><span class="b">Agent's screen / phone</span><i>→</i><span>API: checks login, company, permission</span><i>→</i><span>Database</span><i>&nbsp;&nbsp;|&nbsp;&nbsp;</i><span class="o">Meta · WhatsApp · Portals · Website</span><i>→</i><span>API webhooks</span><i>→</i><span>New lead, assigned in under 1 minute</span></div>
<div class="grid">
<div class="box"><b>Safe</b>Two-factor login. Every request is checked for company, role and data scope. A user can never see another company's data.</div>
<div class="box"><b>Reliable</b>No double imports or double clicks: repeated requests are recognised. Incoming leads are saved first and retried automatically if anything fails.</div>
<div class="box"><b>Clear errors</b>When a rule stops an action, the screen shows a plain message, e.g. "This lead already exists, owned by Sara".</div></div>
<h2>Modules at a glance</h2>
<table class="toc"><tbody>{toc}</tbody></table>
<h2>Every feature and the APIs behind it</h2><div class="fm">{fmh}</div>
<h2>Messages users may see when a rule stops an action</h2><div class="cd">{codesh}</div>
<h2>All APIs by module</h2>
<p class="in"><span class="m" style="background:#2563eb">GET</span> view · <span class="m" style="background:#16a34a">POST</span> create or do · <span class="m" style="background:#b7791f">PUT</span> set · <span class="m" style="background:#9333ea">PATCH</span> edit · <span class="m" style="background:#dc2626">DELETE</span> remove. "Who can use it" shows the default roles; Admin can change these and create custom roles.</p>
{secs}
'''
open("crm-docs/web/api_overview.html","w").write(page)

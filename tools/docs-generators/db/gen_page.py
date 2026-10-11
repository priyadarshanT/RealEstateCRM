import json, html, re
d=json.load(open("catalog.json")); T=d["T"]; meta=d["meta"]
E=json.load(open("erd/erds.json"))
tests=json.load(open("test_results.json"))
ov=open("erd/overview.svg").read()
COL={"org":"#0d9488","leads":"#3b6fe0","assign":"#3b6fe0","tasks":"#8b5cf6","msg":"#1f9d63","proj":"#e39a00","fin":"#c0362c","att":"#0f3b45","int":"#5b6b75","bill":"#b8326f"}
SIMPLE={
"org":"Each customer company (tenant) has its own users, teams and roles. Roles decide what each person can do; Admin can create new roles such as HR.",
"leads":"Every buyer is one lead. Each time they enquire, an enquiry row is added (repeat enquiries go to the same lead and agent). Every stage change, owner change and share is recorded and can never be edited.",
"assign":"Rules decide which agent gets a new lead. Campaigns, daily ad spend and events tell us where leads came from and what they cost.",
"tasks":"Calls, follow-ups, meetings and viewings. Each agent has a booking page so clients can book themselves. The database itself blocks double booking.",
"msg":"All WhatsApp and email messages with their delivery status, approved templates, bulk campaigns and each lead's consent history.",
"proj":"Developers, projects, buildings and units for sale, with every price and status change kept. A deal links a buyer to one unit; a unit can only be booked once.",
"fin":"Invoices and purchase orders with lines, VAT, payments and full approval history. After approval, amounts are locked by the database.",
"att":"One attendance row per person per day with check-in photo. Corrections keep the original values. Approved leave cannot overlap and blocks new leads.",
"bill":"How we sell the CRM. Each customer company has one subscription: plan, number of paid users (seats), monthly or yearly, card or bank transfer. We send VAT invoices; Stripe confirms card payments and the platform team confirms bank transfers. If payment fails, the company gets 14 days, then becomes read-only; data is never deleted while unpaid. The owner console is only for the platform team.",
"int":"Connected accounts (Meta, portals, WhatsApp, Google, Microsoft, webhook), every incoming webhook, sync runs, Meta reconciliation, files, exports and the audit log.",
}
def esc(x): return html.escape(str(x))
def nice_check(c):
    c=re.sub(r"::text|::character|::bpchar|::smallint\[\]|::numeric|::date|::timestamp with time zone","",c)
    c=c.replace("ARRAY[","[").replace("CHECK ","")
    return c
def table_block(t,color):
    v=T[t]; pk=set(v["pk"]); fkm=v["fkmap"]
    rows=""
    for c in v["cols"]:
        n=c["name"]; key=[]
        if n in pk: key.append('<span class="k pk">PK</span>')
        if n in fkm: key.append(f'<span class="k fk">FK → {fkm[n]}</span>')
        de=c["default"]
        if c["gen"]: de="calculated: "+c["gen"]
        de=re.sub(r"::\w+(\[\])?","",de).replace("gen_random_uuid()","auto (uuid)")
        desc=esc(json.load(open("colc.json")).get(f"{t}.{n}","") if False else "")
        rows+=f'<tr><td class="cn">{esc(n)}</td><td class="ty">{esc(c["type"])}</td><td class="rq">{"" if c["null"] else "Yes"}</td><td>{" ".join(key)}</td><td class="df">{esc(de)}</td><td>{esc(COLC.get((t,n),""))}</td></tr>'
    rules=[]
    for u in v["uq"]:
        rules.append(("Unique",u.replace("UNIQUE NULLS NOT DISTINCT","Unique (empty values count as equal)").replace("UNIQUE ","")))
    for x in v["ex"]: rules.append(("No overlap",x))
    for ck in v["ck"]: rules.append(("Check",nice_check(ck)))
    for n_,ix in v["ix"]:
        rules.append(("Index",re.sub(r"CREATE (UNIQUE )?INDEX \w+ ON public\.\w+ USING \w+ ",lambda m:("Unique " if m.group(1) else ""),ix)))
    for f in v["fk"]:
        cs=[c for c in f["cols"] if c!="tenant_id"]
        if f["ondel"] in ("cascade","set null"): rules.append(("On delete",f'{", ".join(cs)} → {f["ref"]}: {f["ondel"]}'))
    rh="".join(f'<li><b>{esc(a)}:</b> <code>{esc(b)}</code></li>' for a,b in rules)
    mod,desc=meta[t]
    return f'''<div class="tb" id="t-{t}"><h4 style="border-color:{color}"><span>{t}</span></h4><p class="td">{esc(desc)}</p>
<div class="tw"><table class="dd"><thead><tr><th>Column</th><th>Type</th><th>Required</th><th>Key</th><th>Default</th><th>Meaning</th></tr></thead><tbody>{rows}</tbody></table></div>
{"<details open><summary>Rules and indexes ("+str(len(rules))+")</summary><ul class='rules'>"+rh+"</ul></details>" if rules else ""}</div>'''
# column comments
COLC={}
sch=open("schema.sql").read()
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);",sch,re.S):
    for line in m.group(2).split("\n"):
        mm=re.match(r"\s+(\w+)\s+.*?--\s*(.+)$",line)
        if mm: COLC[(m.group(1),mm.group(1))]=mm.group(2).strip()
passed=sum(1 for r in tests if r[1]=="PASS")
trows="".join(f'<tr><td>{esc(n)}</td><td><span class="ok">✓ {s}</span></td></tr>' for n,s,_ in tests)
toc=""; body=""
n_tables=len(T); n_cols=sum(len(v["cols"]) for v in T.values()); n_fk=sum(len(v["fk"]) for v in T.values())
for i,(key,(title,desc,tables,svg,ext)) in enumerate(E.items(),1):
    toc+=f'<li><a href="#c-{key}">{esc(title)}</a> <small>({len(tables)} tables)</small></li>'
    tlinks=" · ".join(f'<a href="#t-{t}">{t}</a>' for t in tables)
    blocks="".join(table_block(t,COL[key]) for t in tables)
    body+=f'''<section class="ch" id="c-{key}"><h2><span class="num" style="background:{COL[key]}">{i}</span>{esc(title)}</h2>
<div class="simple"><b>In simple words:</b> {esc(SIMPLE[key])}</div>
<p class="tl"><b>Tables:</b> {tlinks}</p>
<div class="erd">{svg}</div><p class="cap">ER diagram: {esc(title)}. Grey boxes are tables from other sections. tenant_id is hidden (every table belongs to a tenant).</p>
{blocks}</section>'''
page=f'''<title>CRM Database Design</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: reading column with wide ERD canvases and scrollable dictionary tables */
:root{{--bg:#f5f7f8;--surface:#fff;--ink:#16232b;--muted:#5d6d78;--line:#dfe5e8;--accent:#0d8a80;--soft:#e3f5f2;--sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#0f171c;--surface:#16222a;--ink:#e5edf1;--muted:#98a9b3;--line:#27353e;--accent:#45c4b8;--soft:#163331;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0f171c;--surface:#16222a;--ink:#e5edf1;--muted:#98a9b3;--line:#27353e;--accent:#45c4b8;--soft:#163331;color-scheme:dark}}
*{{box-sizing:border-box}} body{{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;padding-inline:16px}}
.doc{{max-width:1200px;margin:0 auto;padding-block:36px 72px}}
h1{{font-size:clamp(26px,4vw,34px);margin:0 0 6px;letter-spacing:-.02em}} .sub{{color:var(--muted);margin:0 0 6px}}
h2{{font-size:21px;margin:46px 0 10px;padding-top:18px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:center}}
h3{{font-size:17px;margin:26px 0 8px}}
.num{{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;color:#fff;font-size:13px;font-weight:800;flex:none}}
.kpis{{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:16px 0}}
.kp{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px}} .kp b{{display:block;font-size:22px;font-family:var(--mono);font-weight:500}} .kp small{{color:var(--muted)}}
@media (max-width:760px){{.kpis{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:10px 0}}
.simple{{background:var(--soft);border-radius:10px;padding:10px 14px;margin:6px 0 10px;max-width:900px}}
.cols2{{display:grid;grid-template-columns:1fr 1fr;gap:12px}} @media (max-width:760px){{.cols2{{grid-template-columns:1fr}}}}
.cols2 ul{{margin:4px 0;padding-left:20px}}
.erd{{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;overflow-x:auto}} .erd svg{{max-width:100%;height:auto}}
.cap{{color:var(--muted);font-size:13px;margin:4px 0 14px}} .tl{{font-size:13.5px}} .tl a,.toc a{{color:var(--accent)}}
.tb{{margin:18px 0 24px}} .tb h4{{margin:0;font-size:16px;font-family:var(--mono);border-left:5px solid;padding-left:9px}}
.td{{margin:4px 0 8px;color:var(--muted)}}
.tw{{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface)}}
table.dd,table.t{{border-collapse:collapse;width:100%;font-size:13px}} .dd th,.dd td,.t th,.t td{{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
.dd th,.t th{{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--surface)}}
.cn{{font-family:var(--mono);font-weight:500;white-space:nowrap}} .ty{{font-family:var(--mono);color:var(--muted);white-space:nowrap}} .rq{{color:var(--accent);font-weight:700}} .df{{font-family:var(--mono);font-size:12px;color:var(--muted);max-width:180px;word-break:break-word}}
.k{{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:5px;white-space:nowrap;margin:1px 2px 1px 0}} .pk{{background:#fff1d6;color:#8a5500}} .fk{{background:#e1ecff;color:#1f4fbf}}
details{{margin-top:6px}} summary{{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}}
.rules{{font-size:12.5px;margin:6px 0;padding-left:18px}} .rules code{{font-family:var(--mono);font-size:11.5px;word-break:break-word;white-space:pre-wrap}}
.ok{{color:#11734a;font-weight:700}} .toc{{columns:2;padding-left:20px}} @media (max-width:600px){{.toc{{columns:1}}}}
code{{font-family:var(--mono)}}
@page{{size:A3 landscape;margin:11mm}}
@media print{{:root{{--bg:#fff;--surface:#fff;--ink:#16232b;--muted:#5d6d78;--line:#dfe5e8;--accent:#0d8a80;--soft:#e3f5f2;color-scheme:light}}body{{padding:0;font-size:12px}}.doc{{padding:0;max-width:none}}.erd{{break-inside:avoid}}.erd svg{{max-height:250mm;width:auto}}.tb{{break-inside:auto}}.dd tr{{break-inside:avoid}}h2{{break-before:page}}h2.first{{break-before:auto}}.tw{{overflow:visible}}details>summary{{display:none}}}}
</style>
<div class="doc">
<h1>Database design: ER diagrams and data dictionary</h1>
<p class="sub">Dubai Real Estate CRM · Document 03 · Version 1.2 · 11 October 2026 · Matches SRS v1.2 · PostgreSQL 16</p>
<p class="sub">Generated directly from the tested database, so the diagrams and the dictionary always match the real schema.</p>
<div class="kpis"><div class="kp"><b>{n_tables}</b><small>tables</small></div><div class="kp"><b>{n_cols}</b><small>columns</small></div><div class="kp"><b>{n_fk}</b><small>relationships</small></div><div class="kp"><b>{passed}/{len(tests)}</b><small>rule tests passed</small></div><div class="kp"><b>10</b><small>sections</small></div></div>

<h2 class="first"><span class="num" style="background:#0d8a80">i</span>How the database is designed</h2>
<div class="simple"><b>In simple words:</b> every customer's data is locked inside its own "tenant", so one brokerage can never see another's. Important rules (no double booking, no double import, reasons for Lost, locked invoices) are enforced by the database itself, so even a bug in the app cannot break them. History tables can only be added to, never edited.</div>
<div class="cols2"><div class="card"><b>Design rules (for developers)</b><ul>
<li>Every business table has <code>tenant_id</code> and <code>UNIQUE (tenant_id, id)</code>; child tables use composite foreign keys <code>(tenant_id, x_id)</code>, so cross-tenant links are impossible.</li>
<li>Row-level security on all tenant tables: the API sets <code>app.tenant_id</code> per transaction.</li>
<li>Primary keys: <code>uuid</code> (app generates UUIDv7). Times: <code>timestamptz</code> (UTC). Money: <code>numeric(14,2)</code> + currency.</li>
<li>Value lists are <code>text + CHECK</code>, easy to extend with a migration. Configurable lists (stages, reasons, roles) are tables.</li>
<li>Each module owns its tables; other modules use its service, never its tables.</li></ul></div>
<div class="card"><b>Changes in v1.2 and v1.1</b><ul>
<li><b>v1.2:</b> new Subscriptions &amp; billing section (11 tables): <code>plans</code>, <code>subscriptions</code>, <code>subscription_events</code>, <code>billing_invoices</code>, <code>billing_invoice_lines</code>, <code>billing_payments</code>, <code>tenant_usage_daily</code>, <code>platform_admins</code>, <code>platform_settings</code>, <code>sales_enquiries</code>, <code>platform_audit_logs</code>. <code>tenants</code>: RERA BRN, licence file and verification added, <code>plan</code> moved to <code>subscriptions</code>. Seat limit enforced by the database. New role <code>crm_platform</code>.</li>
<li>New <code>lead_shares</code>: view/edit sharing.</li><li>New <code>booking_pages</code>: replaces Calendly.</li>
<li>Removed <code>lead_duplicates</code> and merge fields; repeat enquiries go to the existing lead (<code>is_re_enquiry</code>, <code>enquiry_count</code>).</li>
<li>10-minute rule: <code>leads.response_due_at</code>; moves logged as <code>no_response</code> / <code>admin_fallback</code>.</li>
<li><code>users.receives_leads</code>: Admin on/off switch.</li><li>Auto-close fields removed. Zoom, Calendly, respond.io, Make removed; Dubizzle added.</li>
<li>Exports: <code>leads.export</code>, <code>reports.export</code>, <code>attendance.export</code>, Admin only by default.</li></ul></div></div>
<div class="cols2"><div class="card"><b>Database files</b><ul>
<li><code>schema.sql</code>: tables, relationships, rules, indexes</li><li><code>security.sql</code>: roles, row-level security, append-only history, invoice locks</li>
<li><code>seed.sql</code>: currencies, permissions, default roles, stages and reasons for each new tenant</li></ul></div>
<div class="card"><b>Database roles</b><ul><li><code>crm_app</code>: API, one tenant per transaction</li><li><code>crm_worker</code>: background jobs across tenants</li><li><code>crm_readonly</code>: support and reporting</li><li><code>crm_platform</code>: owner console and Stripe webhooks</li></ul></div></div>

<h3>Rule tests run on the real database</h3>
<div class="tw"><table class="t"><thead><tr><th>Rule</th><th>Result</th></tr></thead><tbody>{trows}</tbody></table></div>

<h3>Overview: all tables by section</h3>
<div class="erd">{ov}</div><p class="cap">Lines show relationships between tables. Links to tenants, users, files and currencies are left out here to keep it readable; they are in each section's diagram.</p>
<p><b>Contents</b></p><ol class="toc">{toc}</ol>
<div class="card"><b>How to read the ER diagrams:</b> each box is a table. <span class="k pk">PK</span> primary key · <span class="k fk">FK</span> link to another table · <b>*</b> required. Line ends: crow's foot = many, single bar = one, circle = optional.</div>
{body}
</div>'''
open("/home/claude/crm-docs/web/database.html","w").write(page)
print("ok", len(page))

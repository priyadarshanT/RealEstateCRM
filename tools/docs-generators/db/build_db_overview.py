import json,html,sys
sys.path.insert(0,'/home/claude/crm-docs/db')
D='/home/claude/crm-docs/db/'
d=json.load(open(D+'catalog.json'));T=d['T'];meta=d['meta']
E=json.load(open(D+'erd/erds.json')); tests=json.load(open(D+'test_results.json'))
src=open(D+'gen_page.py').read(); ns={}
exec(src[src.index('COL={'):src.index('def esc')],ns); COL,SIMPLE=ns['COL'],ns['SIMPLE']
e=html.escape
EX={"org":"“Skyline Realty” is one company. Sara is a Sales agent in Team Marina; her role lets her see her team's leads only. HR staff get an HR role with no access to leads.",
"leads":"Ahmed enquires on Bayut about a 2-bed in Dubai Hills, so a lead is created. A week later he enquires again on Property Finder. The new enquiry is added to the same lead, and Sara gets a “Re-enquired” alert.",
"assign":"Leads from the “Emaar Beachfront” campaign go to Team Marina in turn. If Sara does not respond in 10 minutes the lead moves to Omar, then Lina, then the Admin, and every move is recorded.",
"tasks":"Ahmed books a viewing on Sara's booking page for Thursday 4 pm. Nobody else can book Sara for that time.",
"msg":"A WhatsApp template “New launch in JVC” is sent to 300 leads who agreed to be contacted. Each message shows sent, delivered or read.",
"proj":"Unit 1204 in Tower B is booked under Ahmed's deal. A second deal for unit 1204 is refused by the database.",
"fin":"An invoice to the developer for AED 52,500 commission plus 5% VAT. After the manager approves it, the amount can no longer be changed.",
"att":"Sara checks in at 9:02 with a photo. While she is on approved leave next week, she gets no new leads.",
"bill":"Skyline Realty is on the Team plan with 10 seats at AED 99 per user. Adding an 11th active user is blocked until they buy a seat. If their card fails they have 14 days to pay, then the CRM becomes read-only. Their data is never deleted while unpaid.",
"int":"The website form sends to the general webhook. The data is saved first, then turned into a lead, and retried automatically if anything fails."}
n_t=len(T); n_fk=sum(len(v['fk']) for v in T.values()); passed=sum(1 for r in tests if r[1]=='PASS')
toc=''.join(f'<tr><td><span class="dot" style="background:{COL[k]}"></span><b>{e(t)}</b></td><td class="n">{len(tb)}</td><td>{e(SIMPLE[k])}</td></tr>' for k,(t,desc,tb,s,x) in E.items())
secs=''
for i,(k,(t,desc,tb,s,x)) in enumerate(E.items(),1):
    rows=''.join(f'<tr><td class="tn">{n}</td><td>{e(meta[n][1])}</td></tr>' for n in tb)
    secs+=f'''<section><h3 style="border-color:{COL[k]}"><span class="num" style="background:{COL[k]}">{i}</span>{e(t)}<small>{len(tb)} tables</small></h3>
<div class="two"><div><p class="in">{e(SIMPLE[k])}</p><p class="ex"><b>Example:</b> {e(EX[k])}</p></div>
<table class="tt"><tbody>{rows}</tbody></table></div></section>'''
tl=''.join(f'<li><span class="ok">✓</span>{e(n)}</li>' for n,s,_ in tests)
svg=open('concept.svg').read(); svg=svg[svg.index('<svg'):]
page=f'''<!doctype html><meta charset="utf-8"><title>CRM Database Overview</title>
<style>
@page{{size:A4;margin:10mm 10mm 12mm}}
:root{{--ink:#16232b;--muted:#5d6d78;--line:#e1e7ea;--accent:#0d8a80;--soft:#e3f5f2}}
*{{box-sizing:border-box}} body{{margin:0;color:var(--ink);font-family:Helvetica,Arial,sans-serif;font-size:9.5px;line-height:1.38;background:#fff}}
h1{{font-size:22px;margin:0 0 2px}} .sub{{color:var(--muted);margin:0 0 8px;font-size:10px}}
h2{{font-size:13.5px;margin:12px 0 5px;color:var(--accent)}}
h3{{display:flex;align-items:center;gap:7px;font-size:12.5px;margin:10px 0 4px;border-bottom:2px solid;padding-bottom:3px;break-after:avoid}} h3 small{{color:var(--muted);font-weight:400;font-size:9px;margin-left:auto}}
.num{{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;color:#fff;font-size:9.5px;font-weight:800}}
table{{border-collapse:collapse;width:100%;font-size:9px}} td,th{{padding:2.5px 5px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:inherit}}
.kp{{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0}} .kp div{{border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:6px;padding:5px 8px}} .kp b{{font-size:16px;display:block}} .kp small{{color:var(--muted)}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}} .box{{border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:#fafcfc}} .box b{{display:block;font-size:10px;margin-bottom:2px;color:var(--accent)}}
.dia{{border:1px solid var(--line);border-radius:6px;padding:4px;text-align:center}} .dia svg{{max-width:100%;height:auto;max-height:200px}}
.cap{{color:var(--muted);font-size:8.5px;margin:2px 0 0}}
.dot{{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}} td.n{{text-align:right;font-weight:700;width:24px}} .toc td:first-child{{width:150px;white-space:nowrap}}
section{{break-inside:avoid}} .two{{display:grid;grid-template-columns:38% 1fr;gap:10px}}
.in{{margin:0 0 4px}} .ex{{margin:0;background:var(--soft);border-radius:5px;padding:5px 7px}} .ex b{{color:#0d5c55}}
.tt td.tn{{font-family:Menlo,Consolas,monospace;font-size:8.3px;white-space:nowrap;color:#36505b;width:1%}}
.tests{{columns:2;column-gap:14px;margin:4px 0;padding:0;list-style:none}} .tests li{{break-inside:avoid;padding:1.5px 0;border-bottom:1px solid var(--line)}} .ok{{color:#11734a;font-weight:800;margin-right:5px}}
.note{{color:var(--muted);font-size:8.8px;margin-top:8px;border-top:1px solid var(--line);padding-top:5px}}
</style>
<h1>Database overview</h1>
<p class="sub">Dubai Real Estate CRM · Document 03 · Version 1.2 · 11 October 2026 · For stakeholders · Full technical version: CRM_Database_Design.pdf</p>
<div class="kp"><div><b>{n_t}</b><small>tables (lists of records)</small></div><div><b>{n_fk}</b><small>links between them</small></div><div><b>{passed}/{len(tests)}</b><small>safety rules tested and passed</small></div><div><b>UAE</b><small>stored in AWS UAE, backed up daily</small></div></div>
<h2>What the database is, in simple words</h2>
<p>The database is the CRM's <b>filing cabinet</b>. Every lead, call, message, unit, deal, invoice and check-in is kept here as a record in a table, much like a row in Excel. Tables are linked: a lead belongs to an agent, a deal points to one unit, an invoice belongs to a deal. The most important business rules are built into the database itself, so they hold even if the app has a bug.</p>
<div class="grid">
<div class="box"><b>Each company's data is separate</b>Every record carries its company. One brokerage can never see, change or link to another brokerage's data.</div>
<div class="box"><b>Nothing is silently lost</b>History (stage changes, owner moves, shares, enquiries, audit log) can only be added to, never edited or deleted. Leads are never auto-deleted.</div>
<div class="box"><b>Rules the app cannot break</b>No double booking, no double import, no unit sold twice, a reason required for Lost, and invoice amounts locked after approval.</div></div>
<h2>The big picture</h2>
<div class="dia">{svg}</div><p class="cap">Simplified: each box is a group of tables. The lead is at the centre; a deal links one lead to one unit and leads to invoices. The subscription decides how many users a company can have.</p>
<h2>The {len(E)} areas at a glance</h2>
<table class="toc"><tbody>{toc}</tbody></table>
<h2>Safety rules proven on a real database ({passed} of {len(tests)} passed)</h2>
<ul class="tests">{tl}</ul>
<h2>Each area: what it stores, with an example</h2>
{secs}
<p class="note">For developers: column-by-column details, data types, keys, indexes and full ER diagrams are in CRM_Database_Design.pdf and in schema.sql, security.sql and seed.sql.</p>
'''
open('/home/claude/crm-docs/web/db_overview.html','w').write(page)

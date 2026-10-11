import json, html, subprocess, re
d=json.load(open("catalog.json")); T=d["T"]; meta=d["meta"]
CH=[
("org","Organization, roles and settings","Who the customer is, who works there, what each role may do, and company settings.",["tenants","roles","role_permissions","permissions","users","divisions","teams","tenant_settings","tenant_currencies","exchange_rates","currencies"]),
("leads","Leads","The heart of the CRM: leads, every enquiry, stages, assignment history, sharing and the timeline.",["leads","lead_inquiries","lead_projects","lead_stage_history","lead_assignments","lead_shares","activities","saved_filters","lead_stages","reasons","lead_sources"]),
("assign","Lead assignment and marketing","Assignment rules for new leads, and the campaigns, ad spend and events that leads come from.",["assignment_rules","assignment_rule_members","campaigns","ad_spend_daily","events"]),
("tasks","Tasks, meetings and notifications","Calls and follow-ups, meetings and viewings (with the agent booking page), calendar sync and notifications.",["tasks","meetings","booking_pages","calendar_event_links","notifications","push_devices"]),
("msg","WhatsApp and email","Conversations, messages, templates, bulk campaigns and consent / opt-out history.",["conversations","messages","message_templates","message_campaigns","message_campaign_recipients","consents"]),
("proj","Projects, units and deals","Developers, projects, buildings, units with price/status history, and deals that link a lead to a unit.",["developers","projects","buildings","units","unit_changes","deals"]),
("fin","Finance","Invoices, purchase orders, lines, payments, approval history and commissions.",["finance_documents","finance_document_lines","payments","finance_document_events","counterparties","document_sequences","commissions"]),
("att","Attendance and leave","Daily check-in/out with photo, corrections with original values kept, leave and policies.",["attendance_records","attendance_corrections","leave_requests","leave_types","attendance_policies","holidays"]),
("bill","Subscriptions, billing and owner console","How we sell the CRM: plans, each customer's subscription and seats, our VAT invoices and payments (card via Stripe or bank transfer), usage, and the owner console.",["plans","subscriptions","subscription_events","billing_invoices","billing_invoice_lines","billing_payments","tenant_usage_daily","platform_admins","platform_settings","sales_enquiries","platform_audit_logs"]),
("int","Integrations, files, reports and audit","Connected accounts, incoming webhooks, sync runs, Meta reconciliation, files, exports and the audit log.",["integrations","webhook_events","integration_sync_runs","reconciliation_runs","files","attachments","export_logs","audit_logs"]),
]
assert sorted(sum([c[3] for c in CH],[]))==sorted(T.keys()), set(T)-set(sum([c[3] for c in CH],[]))
COL={"org":"#0d9488","leads":"#3b6fe0","assign":"#3b6fe0","tasks":"#8b5cf6","msg":"#1f9d63","proj":"#e39a00","fin":"#c0362c","att":"#0f3b45","int":"#5b6b75","bill":"#b8326f"}
def short(t):
    return t.replace("timestamp with time zone","timestamptz").replace("character varying","varchar").replace("bigint","bigint")
def node(t,color,full=True):
    v=T[t]; pk=set(v["pk"]); fkm=v["fkmap"]
    if not full:
        return f'"{t}" [label=<<table border="0" cellborder="0" cellpadding="5" bgcolor="#eef2f4"><tr><td><font color="#46555e" point-size="11"><b>{t}</b></font></td></tr></table>>, shape=box, style="rounded", color="#b9c6cc"];'
    rows=""
    for c in v["cols"]:
        n=c["name"]
        if n=="tenant_id" and t!="tenants": continue
        key="PK" if n in pk else ("FK" if n in fkm else "")
        kc={"PK":"#b7791f","FK":"#3b6fe0"}.get(key,"#ffffff")
        req="" if c["null"] else " *"
        kh=f'<font color="{kc}" point-size="8"><b>{key}</b></font>' if key else ' '
        rows+=f'<tr><td align="left" width="18">{kh}</td><td align="left"><font point-size="10">{n}{req}</font></td><td align="left"><font color="#7b8b95" point-size="9">{html.escape(short(c["type"]))}</font></td></tr>'
    return f'"{t}" [label=<<table border="0" cellborder="0" cellspacing="0" cellpadding="3" bgcolor="white"><tr><td colspan="3" bgcolor="{color}" align="left" cellpadding="6"><font color="white" point-size="12"><b>{t}</b></font></td></tr>{rows}</table>>, shape=plain];'
def edges(tables):
    out=[]; ext=set(); seen={}
    for t in tables:
        v=T[t]
        for f in v["fk"]:
            cs=[c for c in f["cols"] if c!="tenant_id"]
            if not cs: continue
            p=f["ref"]
            if p=="tenants" and t!="users": 
                pass
            key=(t,p); seen.setdefault(key,[]).extend(cs)
    for (t,p),cs in seen.items():
        if p not in tables: ext.add(p)
        colsinfo={c["name"]:c for c in T[t]["cols"]}
        opt=all(colsinfo[c]["null"] for c in cs)
        uniq=any(set(cs)==set(re.findall(r"\(([^)]*)\)",u)[0].replace(" ","").split(",")) - {"tenant_id"} for u in T[t]["uq"]+["PRIMARY KEY ("+",".join(T[t]["pk"])+")"])
        tail="tee" if uniq else "crow"
        head="teeodot" if opt else "teetee"
        lab=", ".join(dict.fromkeys(cs))
        if len(lab)>34: lab=lab[:32]+"…"
        col="#9aa8b1" if p in ("users","files") and p not in tables else "#5d6d78"
        out.append(f'"{t}" -> "{p}" [dir=both, arrowtail={tail}, arrowhead={head}, label=" {lab} ", color="{col}", fontcolor="#5d6d78"];')
    return out,ext
res={}
for key,title,desc,tables in CH:
    nodes=[node(t,COL[key]) for t in tables]
    es,ext=edges(tables)
    ext-= {"tenants"} if key!="org" else set()
    es=[e for e in es if key=="org" or '-> "tenants"' not in e]
    nodes+= [node(t,"",False) for t in sorted(ext)]
    src='digraph G { graph [rankdir=LR, fontname="Helvetica", nodesep=0.35, ranksep=0.9, bgcolor="transparent", pad=0.2, splines=true]; node [fontname="Helvetica"]; edge [fontname="Helvetica", fontsize=9, arrowsize=0.8, penwidth=1.1];\n'+"\n".join(nodes+es)+"\n}"
    open(f"erd/{key}.dot","w").write(src)
    r=subprocess.run(["dot","-Tsvg",f"erd/{key}.dot"],capture_output=True,text=True)
    if r.returncode: print("ERR",key,r.stderr[:300]); continue
    svg=r.stdout[r.stdout.index("<svg"):]
    open(f"erd/{key}.svg","w").write(svg)
    res[key]=(title,desc,tables,svg,sorted(ext))
json.dump({k:list(v) for k,v in res.items()},open("erd/erds.json","w"))
# overview: modules as clusters, table names only, edges excluding tenants/users/files
lines=['digraph O { graph [rankdir=LR, fontname="Helvetica", nodesep=0.25, ranksep=0.7, bgcolor="transparent", compound=true, splines=true]; node [fontname="Helvetica", shape=box, style="rounded,filled", fontsize=10, fillcolor=white, penwidth=1.2]; edge [color="#9aa8b1", arrowsize=0.6, dir=both, arrowtail=crow, arrowhead=tee];']
for key,title,desc,tables in CH:
    lines.append(f'subgraph cluster_{key} {{ label="{title}"; fontsize=12; fontname="Helvetica-Bold"; style="rounded,filled"; fillcolor="{COL[key]}18"; color="{COL[key]}"; fontcolor="{COL[key]}";')
    for t in tables: lines.append(f'"{t}" [color="{COL[key]}"];')
    lines.append("}")
pairs=set()
for t,v in T.items():
    for f in v["fk"]:
        p=f["ref"]
        if p in ("tenants","users","files","currencies") or p==t: continue
        pairs.add((t,p))
for t,p in sorted(pairs): lines.append(f'"{t}" -> "{p}";')
lines.append("}")
open("erd/overview.dot","w").write("\n".join(lines))
r=subprocess.run(["dot","-Tsvg","erd/overview.dot"],capture_output=True,text=True)
open("erd/overview.svg","w").write(r.stdout[r.stdout.index("<svg"):])
print("done",list(res))

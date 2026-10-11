import json, html, re, subprocess
spec=json.load(open("api/openapi.json")); S=spec["components"]["schemas"]; P=spec["components"]["parameters"]
e=html.escape
def tname(s):
    if not isinstance(s,dict): return ""
    if "$ref" in s: n=s["$ref"].split("/")[-1]; return f'<a href="#s-{n}">{n}</a>'
    if "oneOf" in s: return " | ".join(tname(x) for x in s["oneOf"])
    t=s.get("type","object")
    if t=="array": return tname(s["items"])+"[]"
    if t=="null": return "null"
    if "enum" in s: return " | ".join(f"<code>{e(str(v))}</code>" for v in s["enum"])
    f=s.get("format"); return e(t+(f" ({f})" if f else ""))
def schema_table(s):
    if "$ref" in s: return f'<p class="sref">Body: {tname(s)}</p>'
    if s.get("type")=="object" and s.get("properties"):
        req=set(s.get("required",[]))
        rows="".join(f'<tr><td><code>{e(k)}</code>{" *" if k in req else ""}</td><td>{tname(v)}</td><td>{e(v.get("description",""))}</td></tr>' for k,v in s["properties"].items())
        return f'<table class="ft"><tr><th>Field</th><th>Type</th><th>Notes</th></tr>{rows}</table>'
    return f'<p class="sref">Body: {tname(s)}</p>'
md=open("docs/05-API-Guide.md").read()
guide=subprocess.run(["pandoc","-f","gfm","-t","html","--wrap=none"],input=md,capture_output=True,text=True).stdout
guide=guide.replace('<a href="../api/openapi.yaml">','<a href="#ref">')
tags=[t["name"] for t in spec["tags"]]
by={t:[] for t in tags}
for p,ms in spec["paths"].items():
    for m,o in ms.items(): by[o["tags"][0]].append((m,p,o))
ref=""; toc=""
for t in tags:
    tid="t-"+re.sub(r"\W+","-",t.lower())
    toc+=f'<a href="#{tid}">{e(t)} <small>{len(by[t])}</small></a>'
    ref+=f'<h3 id="{tid}">{e(t)}</h3>'
    for m,p,o in by[t]:
        perm=o.get("x-permission")
        perm_html=f'<span class="perm">{e(perm)}</span>' if perm else '<span class="perm pub">public</span>'
        desc=o.get("description","")
        desc=re.sub(r"\*\*Permission:\*\* `[^`]+`","",desc).strip()
        desc=e(desc); desc=re.sub(r"`([^`]+)`",r"<code>\1</code>",desc).replace("\n\n","<br>")
        ps=[]
        for pr in o.get("parameters",[]):
            if "$ref" in pr: pr=P[pr["$ref"].split("/")[-1]]
            ps.append(f'<tr><td><code>{e(pr["name"])}</code>{" *" if pr.get("required") else ""}</td><td>{pr["in"]}</td><td>{tname(pr["schema"])}</td><td>{e(pr.get("description",""))}</td></tr>')
        pt=f'<table class="ft"><tr><th>Parameter</th><th>In</th><th>Type</th><th>Notes</th></tr>{"".join(ps)}</table>' if ps else ""
        body=""
        if "requestBody" in o:
            c=list(o["requestBody"]["content"].values())[0]["schema"]; body=schema_table(c)
        resp=[]
        for code,r in o["responses"].items():
            if "$ref" in r: continue
            sch=""
            if "content" in r:
                sch=list(r["content"].values())[0]["schema"]
                sch=" → "+(tname(sch) if ("$ref" in sch or sch.get("type")!="object" or not sch.get("properties")) else "{ "+", ".join(f"{k}: {tname(v)}" for k,v in sch["properties"].items())+" }")
            resp.append(f'<span class="rc ok">{code}</span> {e(r["description"])}{sch}')
        errs=[c for c,r in o["responses"].items() if "$ref" in r]
        resp.append('<span class="rc er">'+" ".join(errs)+'</span> standard errors')
        ref+=f'''<div class="ep"><div class="eh"><span class="m {m}">{m.upper()}</span><code class="p">{e(p)}</code><span class="sum">{e(o["summary"])}</span>{perm_html}</div>
{f'<p class="d">{desc}</p>' if desc else ''}{pt}{body}<div class="rs">{"<br>".join(resp)}</div></div>'''
schemas=""
for n,s in S.items():
    d=s.get("description","")
    schemas+=f'<div class="sc" id="s-{n}"><h4>{n}</h4>{f"<p class=d>{e(d)}</p>" if d else ""}{schema_table(s)}</div>'
page=f'''<title>CRM API Reference</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: guide then reference; endpoints as compact cards with method chips */
:root{{--bg:#f5f7f8;--surface:#fff;--ink:#16232b;--muted:#5d6d78;--line:#dfe5e8;--accent:#0d8a80;--sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
--get:#2563eb;--post:#16a34a;--put:#b7791f;--patch:#9333ea;--delete:#dc2626}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#0f171c;--surface:#16222a;--ink:#e5edf1;--muted:#98a9b3;--line:#27353e;--accent:#45c4b8;--get:#60a5fa;--post:#4ade80;--put:#fbbf24;--patch:#c084fc;--delete:#f87171;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0f171c;--surface:#16222a;--ink:#e5edf1;--muted:#98a9b3;--line:#27353e;--accent:#45c4b8;--get:#60a5fa;--post:#4ade80;--put:#fbbf24;--patch:#c084fc;--delete:#f87171;color-scheme:dark}}
*{{box-sizing:border-box}} body{{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;padding-inline:16px}}
.doc{{max-width:1100px;margin:0 auto;padding-block:32px 72px}}
h1{{font-size:clamp(26px,4vw,34px);margin:0 0 6px;letter-spacing:-.02em}} h2{{font-size:21px;margin:40px 0 10px;padding-top:16px;border-top:1px solid var(--line)}}
h3{{font-size:18px;margin:30px 0 10px;color:var(--accent)}} h4{{margin:0 0 6px;font-family:var(--mono);font-size:14.5px}}
code{{font-family:var(--mono);font-size:.86em}} pre{{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font-size:13px}}
table{{border-collapse:collapse;width:100%;font-size:13.5px;background:var(--surface)}} th,td{{border-bottom:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}} th{{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}}
.guide table{{border:1px solid var(--line);display:block;overflow-x:auto}}
.toc{{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}} .toc a{{background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:3px 11px;font-size:13px;color:var(--ink);text-decoration:none}} .toc small{{color:var(--muted)}}
.ep{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;break-inside:avoid}}
.eh{{display:flex;flex-wrap:wrap;gap:8px;align-items:center}} .p{{font-weight:500;word-break:break-all}} .sum{{color:var(--muted)}}
.m{{font-family:var(--mono);font-weight:700;font-size:11px;color:#fff;border-radius:5px;padding:2px 7px;min-width:54px;text-align:center}}
.m.get{{background:var(--get)}} .m.post{{background:var(--post)}} .m.put{{background:var(--put)}} .m.patch{{background:var(--patch)}} .m.delete{{background:var(--delete)}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]) .m{{color:#0f171c}}}} :root[data-theme="dark"] .m{{color:#0f171c}}
.perm{{margin-left:auto;font-family:var(--mono);font-size:11.5px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;color:var(--muted)}} .perm.pub{{color:var(--accent);border-color:var(--accent)}}
.d{{margin:6px 0;font-size:13.5px}} .ft{{margin:6px 0;font-size:12.5px;border:1px solid var(--line)}} .sref{{font-size:13px;margin:6px 0}}
.rs{{font-size:12.5px;color:var(--muted);margin-top:6px}} .rc{{font-family:var(--mono);font-weight:700;margin-right:4px}} .rc.ok{{color:var(--post)}} .rc.er{{color:var(--delete)}}
.sc{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;break-inside:avoid}}
a{{color:var(--accent)}}
@page{{size:A4;margin:12mm}}
@media print{{:root{{--bg:#fff;--surface:#fff;--ink:#16232b;--muted:#5d6d78;--line:#dfe5e8;--accent:#0d8a80;--get:#2563eb;--post:#16a34a;--put:#b7791f;--patch:#9333ea;--delete:#dc2626;color-scheme:light}}body{{padding:0;font-size:12px}}.doc{{padding:0}}.m{{color:#fff!important}}h2{{break-before:page}}h2.first{{break-before:auto}}}}
</style>
<div class="doc"><div class="guide">{guide}</div>
<h2 id="ref">API reference</h2><p>Every endpoint from <code>api/openapi.yaml</code>. <b>*</b> = required. The chip on the right is the permission needed.</p>
<div class="toc">{toc}<a href="#models">Data models <small>{len(S)}</small></a></div>
{ref}
<h2 id="models">Data models</h2>{schemas}</div>'''
page=page.replace("<h1","<h1",1)
open("/home/claude/crm-docs/web/api.html","w").write(page)
print(len(page))

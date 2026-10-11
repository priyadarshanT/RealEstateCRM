import json,re
exec(open("explain2.py").read())
d=json.load(open("svgs.json"))
old=open("../workflows.html").read()
head=old[:old.index('<div class="doc">')]
groups=[("Leads",["lifecycle","intake","reenquiry","share","assign","escalation"]),("Tasks and meetings",["call","meeting"]),("Messaging",["campaign"]),("Deals and finance",["deal","invoice"]),("Attendance",["attendance","leave"]),("Reports",["export"]),("Subscriptions and billing",["signup","dunning","cancel"])]
key=old[old.index('<div class="key">'):old.index('</div>',old.index('<div class="key">'))+6]
n=0;secs="";toc=""
for g,ks in groups:
    secs+=f'<h2>{g}</h2>'
    for k in ks:
        n+=1;t,c,svg=d[k];a,b,w=X[k]
        toc+=f'<li><a href="#{k}">{t}</a></li>'
        lay=f'<div class="lay"><div class="lc s"><span class="lt">In simple words</span>{a}</div><div class="lc e"><span class="lt">Real example</span>{b}</div><div class="lc w"><span class="lt">Why it matters</span>{w}</div></div>'
        secs+=f'<section class="wf" id="{k}"><h3><span class="n">{n}</span>{t}</h3><p class="cap">{c}</p>{lay}<div class="cv">{svg}</div></section>'
body=f'''<div class="doc">
<h1>Workflow diagrams</h1>
<p class="sub">Each workflow shows the steps in a picture, explains them in simple words, and gives a real Dubai real estate example.</p>
<p class="sub">Dubai Real Estate CRM · Document 04 · Version 1.2 · 11 October 2026 · Matches SRS v1.2</p>
{key}
<p><b>Contents</b></p><ol class="toc">{toc}</ol>
{secs}
</div>'''
open("../workflows.html","w").write(head+body); print(n)

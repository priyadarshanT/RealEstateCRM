import re
body=open("srs_body.html").read()
body=re.sub(r'<pre class="mermaid"><code>(.*?)</code></pre>',lambda m:'<pre class="mermaid">'+m.group(1)+'</pre>',body,flags=re.S)

MENU=["Dashboard","Leads","Tasks & Calendar","WhatsApp & Email","Projects","Invoices & POs","Reports","Attendance","Team","Organization","Settings & Integrations"]
ICON={"Dashboard":"▦","Leads":"◉","Tasks & Calendar":"▤","WhatsApp & Email":"✉","Projects":"⌂","Property Listings":"▥","Invoices & POs":"₪","Reports":"▨","Attendance":"◷","Team":"☺","Organization":"◈","Settings & Integrations":"⚙"}
def side(active):
    items="".join(f'<div class="mi{" on" if m==active else ""}"><span>{ICON[m]}</span>{m}</div>' for m in MENU)
    return f'<aside class="sb"><div class="logo">● Estate<b>CRM</b></div>{items}</aside>'
def top(title,extra=""):
    return f'<div class="tb"><div class="tt">{title}</div><div class="srch">⌕ Search name, phone or email…</div>{extra}<div class="av">AK</div></div>'
def app(active,title,content,extra=""):
    return f'<div class="app">{side(active)}<div class="main">{top(title,extra)}<div class="pg">{content}</div></div></div>'
def wf(title,caption,inner):
    return f'<figure class="wf"><figcaption><span class="tag">Draft wireframe</span>{title}</figcaption><div class="frame">{inner}</div><p class="cap">{caption}</p></figure>'
def chip(t,c): return f'<span class="chip {c}">{t}</span>'
def btn(t,c="pri"): return f'<span class="btn {c}">{t}</span>'

# ---------- 1 Lead list ----------
tabs=["All Leads","My Leads","Shared with Me","Team Leads","Unassigned","Deleted","New","Pending","Scheduled","Overdue","Cold"]
tabh="".join(f'<span class="tab{" on" if t=="My Leads" else ""}">{t}{" <i>128</i>" if t=="My Leads" else ""}{" <i class=r>6</i>" if t=="Overdue" else ""}</span>' for t in tabs)
rows=[("Ahmed Al Mansoori","+971 50 123 4567","Emaar Beachfront","Meta · Beachfront Q4","92","Hot","hot","Today 4:00 PM",""),
("Priya Sharma","+971 55 987 1122","Sobha Hartland","Property Finder","81","Qualified","qual","Tomorrow 11:00",""),
("James Carter","+44 7700 900123","Dubai Hills","Google · Villas","64","Follow-up","fol","Yesterday","od"),
("Fatima Khan","+971 52 444 9090","Damac Lagoons","Bayut","48","Attempted","att","Today 6:30 PM",""),
("Oleg Petrov","+7 916 555 0101","Emaar Beachfront","WhatsApp","22","No Response","nr","12 Oct","")]
tr="".join(f'<tr><td><input type="checkbox"></td><td><b>{a}</b><br><small>{b}</small></td><td>{c}</td><td><small>{d}</small></td><td><span class="score s{int(e)//34}">{e}</span></td><td>{chip(f,g)}</td><td class="{"red" if i=="od" else ""}">{h}</td><td><span class="ava">SA</span></td></tr>' for a,b,c,d,e,f,g,h,i in rows)
lead_list=app("Leads","Leads",f'''
<div class="tabs">{tabh}</div>
<div class="fbar"><span class="f">📅 Last 30 days ▾</span><span class="f">Project ▾</span><span class="f">Source ▾</span><span class="f">Campaign ▾</span><span class="f">Agent ▾</span><span class="f">Stage ▾</span><span class="f">Budget ▾</span><span class="f sv">★ Saved: Hot this week ▾</span><span class="sp"></span><span class="f">⚙ Columns</span>{btn("⤓ Export","ghost")}{btn("+ New lead")}</div>
<div class="bulk">2 selected · <u>Assign</u> · <u>Change stage</u> · <u>Send WhatsApp</u> · <u>Delete</u></div>
<table class="tbl"><thead><tr><th></th><th>Name / Phone</th><th>Project</th><th>Source · Campaign</th><th>Score</th><th>Stage</th><th>Next follow-up</th><th>Agent</th></tr></thead><tbody>{tr}</tbody></table>''',btn("🔔 3","ghost"))

# ---------- 2 Lead page ----------
tl=[("lead","↻","Re-enquired via Bayut · Sara notified","Same phone · added to this lead · Today 9:40"),("call","📞","Call · No answer","Sara A. · Today 10:12"),("wa","💬","WhatsApp sent: Beachfront brochure","Delivered ✓✓ · Today 10:15"),("stage","↗","Stage changed: Warm → Hot","Sara A. · Today 10:20"),("note","✎","Note: Wants 2-bed, sea view, budget AED 3.2M","Sara A. · Yesterday"),("meet","📅","Viewing booked via booking page · Sat 2 PM","Google Meet link attached · Yesterday"),("lead","⇣","Lead received · Meta form \"Beachfront Q4\"","Campaign 2384… · Ad set 9921… · 3 days ago")]
tlh="".join(f'<div class="ev {c}"><span class="ei">{i}</span><div><b>{t}</b><br><small>{s}</small></div></div>' for c,i,t,s in tl)
lead_page=app("Leads","Ahmed Al Mansoori",f'''
<div class="lp">
 <div class="lcol">
  <div class="card"><div class="lh"><span class="big ava">AM</span><div><b>Ahmed Al Mansoori</b><br><small>UAE · English, Arabic</small></div></div>
  <div class="kv"><span>Phone</span><b>+971 50 123 4567</b><span>Alt. phone</span><b>+971 4 555 0000</b><span>Email</span><b>ahmed@mail.com</b><span>Budget</span><b>AED 3.0–3.5M</b><span>Source</span><b>Meta · Beachfront Q4</b><span>Owner</span><b>Sara Ali ▾</b><span>Priority</span><b>{chip("High","hot")}</b><span>Shared with</span><b>Mira · {chip("Can edit","fol")}</b></div></div>
  <div class="card"><small class="lbl">LEAD SCORE</small><div class="meter"><div style="width:92%"></div></div><b class="sc">92 / 100</b><small>Budget fit · Project match · Replied on WhatsApp</small></div>
  <div class="card"><small class="lbl">PROJECTS</small><div>{chip("Emaar Beachfront ★","qual")} {chip("Dubai Harbour","fol")}</div><small class="lbl">DEAL</small><div>Unit 1204 · Sea view · AED 3.25M · {chip("EOI Submitted","eoi")}</div></div>
 </div>
 <div class="ccol">
  <div class="stg">{"".join(f'<span class="st{" done" if i<5 else (" now" if i==5 else "")}">{s}</span>' for i,s in enumerate(["New","Pending","Attempted","Follow-up","Warm","Hot","Qualified","Meeting","Viewing","EOI","Booked","Won"]))}</div>
  <div class="acts">{btn("✎ Add note","ghost")}{btn("📞 Log call","ghost")}{btn("💬 WhatsApp","wa")}{btn("✉ Email","ghost")}{btn("📅 Schedule","ghost")}{btn("📎 Attach","ghost")}{btn("👥 Share","ghost")}</div>
  <div class="next">⏰ <b>Next follow-up:</b> Today 4:00 PM · Call back about payment plan</div>
  <div class="card tl"><small class="lbl">TIMELINE</small>{tlh}</div>
 </div>
</div>''')

# ---------- 2b Re-enquiry ----------
dup=app("Leads","Leads › New lead",f'''
<div class="two">
 <div class="card"><small class="lbl">NOTIFICATION TO SARA (PREVIOUS AGENT)</small>
  <div class="ev lead"><span class="ei">↻</span><div><b>Re-enquired: Priya Sharma</b><br><small>Via Dubizzle · Sobha Hartland 3-bed · 2 min ago</small></div></div>
  <div class="note ok">No new lead was created. The enquiry was added to Priya's existing lead, which stays with Sara.</div>
  <div class="acts">{btn("Open lead")}{btn("📞 Call now","ghost")}</div></div>
 <div class="card"><small class="lbl">AGENT TYPES A LEAD THAT ALREADY EXISTS</small>
  <div class="kv"><span>Name</span><b class="inp">Priya S.</b><span>Phone</span><b class="inp">+971 55 987 1122</b></div>
  <div class="note err">⚠ This lead already exists, owned by <b>Sara Ali</b> (stage: Qualified).</div>
  <div class="acts r">{btn("Cancel","ghost")}{btn("Open existing lead")}</div></div>
</div>''')

# ---------- 3 Tasks ----------
days=["Sun 11","Mon 12","Tue 13","Wed 14","Thu 15"]
ev={0:[("9:00","📞 Call · Ahmed","call"),("14:00","🏠 Viewing · Priya","view")],1:[("10:00","🎥 Google Meet · James","meet"),("16:00","📞 Call · Fatima","call od")],2:[("11:00","📞 Call · Oleg","call"),("15:30","✓ Send offer","done")],3:[("12:00","🏠 Viewing · Ahmed","view")],4:[("10:30","🎥 Booking page · New client","meet")]}
cols="".join(f'<div class="dcol"><div class="dh">{d}</div>'+"".join(f'<div class="evb {c}"><small>{t}</small><br>{n}</div>' for t,n,c in ev[i])+'</div>' for i,d in enumerate(days))
tasks=app("Tasks & Calendar","Tasks & Calendar",f'''
<div class="fbar"><span class="seg"><span>Day</span><span class="on">Week</span><span>Month</span><span>List</span></span><span class="f">My tasks ▾</span><span class="f">All types ▾</span><span class="sp"></span>{chip("2 overdue","hot")}{btn("+ New task")}</div>
<div class="cal">{cols}</div>
<div class="modal"><b>Log call · Fatima Khan</b><div class="kv"><span>Outcome</span><b>{chip("Answered","qual")} {chip("No answer","nr")} {chip("Busy","att")} {chip("Wrong number","nr")} {chip("Call back","fol")}</b><span>Note</span><b class="inp">Interested in 3-bed, call after 6 PM</b><span>Next action</span><b class="inp">📞 Call · Mon 13 Oct, 6:30 PM · remind 15 min before</b></div><div class="acts r">{btn("Save","pri")}</div></div>''')

# ---------- 4 Team ----------
def tog(on): return f'<span class="tog{" on" if on else ""}"><i></i></span>'
urows=[("Sara Ali","Team Leader","Beachfront","Active",True),("Ali Hassan","Sales Agent","Beachfront","Active",True),("Mira Petrova","Sales Agent","Beachfront","Active",True),("John Smith","Sales Agent","Beachfront","Active",False),("Hana Noor","Finance","—","Active",False),("Rashid M.","HR (custom)","—","Inactive",False)]
uh="".join(f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{chip(d,"qual" if d=="Active" else "nr")}</td><td>{tog(e)}</td></tr>' for a,b,c,d,e in urows)
perms=["View leads","Edit leads","Share leads","Export data","View attendance","Approve leave"]
pm={"Sales":[1,1,1,0,0,0],"Basic":[1,0,0,0,0,0],"HR":[0,0,0,0,1,1]}
ph="".join(f'<tr><td>{p}</td>'+"".join(f'<td class="c">{"☑" if pm[r][i] else "☐"}</td>' for r in pm)+'</tr>' for i,p in enumerate(perms))
team=app("Team","Team",f'''
<div class="tabs"><span class="tab on">Manage users</span><span class="tab">Manage team</span><span class="tab">Roles & permissions</span></div>
<div class="two">
 <div class="card"><small class="lbl">MANAGE USERS</small>
  <table class="tbl sm"><thead><tr><th>User</th><th>Role</th><th>Team</th><th>Status</th><th>Receives leads</th></tr></thead><tbody>{uh}</tbody></table>
  <div class="note">Admin switches "Receives leads" off: the user keeps existing leads but gets no new ones.</div></div>
 <div class="card"><small class="lbl">ROLES & PERMISSIONS (CUSTOM ROLES)</small>
  <table class="tbl sm"><thead><tr><th>Permission</th><th class="c">Sales</th><th class="c">Basic</th><th class="c">HR</th></tr></thead><tbody>{ph}</tbody></table>
  <div class="acts">{btn("+ New role","ghost")}</div></div>
</div>''')
hier=app("Team","Team › Manage team",f'''
<div class="tabs"><span class="tab">Manage users</span><span class="tab on">Manage team</span><span class="tab">Roles & permissions</span></div>
<div class="two">
 <div class="card"><small class="lbl">HIERARCHY</small>
  <div class="tree"><div class="n d">Director · Khalid</div><div class="lv"><div class="n g">GM · Residential</div><div class="lv"><div class="n m">Sales Manager · Omar</div><div class="lv"><div class="n l">Team Leader · Sara</div><div class="lv agents"><span class="n a">Agent · Ali ●</span><span class="n a">Agent · Mira ●</span><span class="n a off">Agent · John (no new leads)</span></div></div></div></div></div>
 </div>
 <div class="card"><small class="lbl">IF A NEW LEAD IS NOT ANSWERED IN 10 MINUTES</small>
  <div class="rule"><b>1</b> Assigned to <u>Ali</u> · 10 min to act</div>
  <div class="rule"><b>2</b> No action → moves to <u>Mira</u> (next in team) · 10 min</div>
  <div class="rule"><b>3</b> No action → next available agent, until the whole team is tried</div>
  <div class="rule muted"><b>⤵</b> Nobody acted → <u>Admin</u> is notified and decides</div>
  <div class="note">Every move is logged: "No response from agent".</div>
 </div>
</div>''')

# ---------- 5 WhatsApp ----------
wa=app("WhatsApp & Email","WhatsApp & Email",f'''
<div class="walay">
 <div class="clist">{"".join(f'<div class="ci{" on" if i==0 else ""}"><b>{n}</b><small>{m}</small>{"<i>2</i>" if i==1 else ""}</div>' for i,(n,m) in enumerate([("Ahmed Al Mansoori","Thanks, Saturday works"),("Priya Sharma","Can you share floor plan?"),("James Carter","Email · Re: Dubai Hills villas")]))}</div>
 <div class="chat"><div class="ch">💬 Ahmed Al Mansoori · WhatsApp {chip("Consent ✓","qual")}</div>
  <div class="msg out">Hi Ahmed, here is the Emaar Beachfront brochure 📎<small>Delivered ✓✓ 10:15</small></div>
  <div class="msg in">Thanks, Saturday works for the viewing<small>10:32</small></div>
  <div class="msg out">Great! Confirmed Sat 2 PM. Location pin below.<small>Read ✓✓ 10:35</small></div>
  <div class="cmp"><span>Type a reply…</span>{btn("Templates ▾","ghost")}{btn("Send","wa")}</div></div>
 <div class="card camp"><small class="lbl">BULK CAMPAIGN</small><div class="kv"><span>Audience</span><b>Stage = Warm · Project = Beachfront<br><small>1,240 leads · 38 opted out excluded</small></b><span>Template</span><b>beachfront_launch (approved)</b><span>Sent</span><b>Tue 14 Oct, 11:00</b></div>
 <div class="steps"><span class="ok">Draft ✓</span><span class="ok">Test sent ✓</span><span class="ok">Approved ✓</span><span class="now">Sent</span></div>
 <div class="stats"><div><b>1,202</b><small>Delivered</small></div><div><b>186</b><small>Replied</small></div><div><b>14</b><small>Failed</small></div></div></div>
</div>''')

# ---------- 6 Projects ----------
units=[("1204","2 BR","1,280","Sea","3,250,000","Booked","eoi"),("1205","2 BR","1,265","Marina","3,050,000","Available","qual"),("1501","3 BR","1,840","Sea","4,900,000","On Hold","att"),("1702","1 BR","820","City","1,950,000","Sold","nr")]
proj=app("Projects","Projects › Emaar Beachfront",f'''
<div class="fbar"><span class="f">Project: Emaar Beachfront ▾</span><span class="f">Building: Tower A ▾</span><span class="f">Type ▾</span><span class="f">Bedrooms ▾</span><span class="f">Price ▾</span><span class="f">Status ▾</span><span class="sp"></span>{btn("+ Add unit")}</div>
<div class="pj"><div class="pimg">🏙<br><small>Project images</small></div><div><b>Emaar Beachfront · Tower A</b><br><small>Developer: Emaar · Handover Q4 2027 · Payment plan 80/20</small><div class="acts">{btn("📄 Brochure","ghost")}{btn("📐 Floor plans","ghost")}</div></div><div class="inv"><div><b>42</b><small>Available</small></div><div><b>8</b><small>On hold</small></div><div><b>31</b><small>Booked</small></div><div><b>119</b><small>Sold</small></div></div></div>
<table class="tbl"><thead><tr><th>Unit</th><th>Type</th><th>Size (sq ft)</th><th>View</th><th>Price (AED)</th><th>Status</th><th></th></tr></thead><tbody>{"".join(f"<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{d}</td><td>{e}</td><td>{chip(f,g)}</td><td><small>History ›</small></td></tr>" for a,b,c,d,e,f,g in units)}</tbody></table>''')

# ---------- 7 Invoice ----------
inv=app("Invoices & POs","Invoices & POs › INV-2026-0042",f'''
<div class="steps big"><span class="ok">Draft</span><span class="ok">Approved</span><span class="ok">Sent</span><span class="now">Partially Paid</span><span>Paid</span></div>
<div class="two">
 <div class="card"><div class="ih"><b>SALES INVOICE</b><b>INV-2026-0042</b></div><div class="kv"><span>Bill to</span><b>Emaar Properties (developer)</b><span>Linked to</span><b>Lead: Ahmed Al Mansoori · Unit 1204 · Deal #318</b><span>Issued / Due</span><b>05 Oct 2026 / 04 Nov 2026</b></div>
 <table class="tbl sm"><thead><tr><th>Item</th><th>Amount</th><th>VAT 5%</th><th>Total</th></tr></thead><tbody><tr><td>Commission 2% · Unit 1204</td><td>65,000</td><td>3,250</td><td>68,250</td></tr></tbody></table>
 <div class="tot"><span>Paid</span><b>40,000</b><span>Balance</span><b class="red">28,250</b></div></div>
 <div class="card"><small class="lbl">ACTIONS</small><div class="acts col">{btn("⤓ Download PDF","ghost")}{btn("+ Record payment")}{btn("Cancel invoice","danger")}</div><small class="lbl">HISTORY</small><div class="hist"><small>✓ Created by Hana (Finance) · 05 Oct</small><small>✓ Approved by Khalid (Director) · 05 Oct</small><small>✓ Sent to developer · 06 Oct</small><small>₪ Payment 40,000 · 09 Oct</small></div></div>
</div>''')

# ---------- 8 Reports ----------
rp=app("Reports","Reports › Marketing",f'''
<div class="two narrowl">
 <div class="card rlist">{"".join(f'<div class="ri{" on" if r=="Marketing (spend & CPL)" else ""}">{r}</div>' for r in ["Lead master","Lead status","Source / campaign","Marketing (spend & CPL)","Agent performance","Lead funnel","Meetings & viewings","Campaign results","Meta reconciliation","Events & roadshows","Sales by project","Invoices & payments","Commissions","Attendance"])}</div>
 <div><div class="fbar"><span class="f">📅 Sep 2026 ▾</span><span class="f">Project ▾</span><span class="f">Source ▾</span><span class="f">Campaign ▾</span><span class="f">Team ▾</span><span class="f">Agent ▾</span><span class="sp"></span>{btn("⤓ Excel","ghost")}{btn("⤓ CSV","ghost")}</div>
 <table class="tbl"><thead><tr><th>Campaign</th><th>Spend (AED)</th><th>Leads</th><th>CPL</th><th>Qualified</th><th>Cost / qualified</th></tr></thead><tbody>
 <tr><td>Meta · Beachfront Q4</td><td>18,400</td><td>412</td><td>44.7</td><td>61</td><td>301.6</td></tr>
 <tr><td>Google · Villas</td><td>9,750</td><td>138</td><td>70.7</td><td>29</td><td>336.2</td></tr>
 <tr><td>Event · Cityscape roadshow</td><td>25,000</td><td>96</td><td>260.4</td><td>33</td><td>757.6</td></tr>
 <tr class="trow"><td><b>Total</b></td><td><b>53,150</b></td><td><b>646</b></td><td><b>82.3</b></td><td><b>123</b></td><td><b>432.1</b></td></tr></tbody></table>
 <div class="note">Totals here always match the Excel and CSV files. Every export is logged.</div></div>
</div>''')

# ---------- 9 Attendance (phone + manager) ----------
phone=f'''<div class="phone"><div class="pbar">9:02 AM</div><div class="pin"><b>Good morning, Ali</b><small>Thu 15 Oct · Office hours 9:00–18:00</small>
<div class="cam">📷<br><small>Live photo</small></div><small>📍 Location: Business Bay office</small>
<div class="cbtn">CHECK IN</div><small class="ok">On time</small></div></div>'''
att=f'''<div class="duo">{phone}{app("Attendance","Attendance › Corrections",f"""
<table class="tbl"><thead><tr><th>Employee</th><th>Date</th><th>Original</th><th>Requested</th><th>Reason</th><th></th></tr></thead><tbody>
<tr><td><b>Mira</b></td><td>13 Oct</td><td>{chip("Absent","nr")}</td><td>{chip("Present 9:10","qual")}</td><td><small>Phone battery died</small></td><td>{btn("Approve")} {btn("Reject","ghost")}</td></tr>
<tr><td><b>John</b></td><td>12 Oct</td><td>{chip("Late 9:40","att")}</td><td>{chip("Present 9:05","qual")}</td><td><small>Site visit</small></td><td>{btn("Approve")} {btn("Reject","ghost")}</td></tr></tbody></table>
<div class="note">Both the original and the corrected entry are kept.</div>
<div class="stats"><div><b>18</b><small>Present</small></div><div><b>2</b><small>Late</small></div><div><b>1</b><small>Absent</small></div><div><b>3</b><small>Leave</small></div><div><b>2</b><small>WFH</small></div></div>""")}</div>'''

# ---------- booking page ----------
book=f'''<div class="phone"><div class="pbar">crm.alnoor.ae/book/sara</div><div class="pin left"><b>Book a call with Sara Ali</b><small>Al Noor Realty · times shown in your time zone (London)</small>
<div class="slots"><small class="lbl">TUE 14 OCT</small><span class="sl">7:00</span><span class="sl on">8:00</span><span class="sl">10:30</span><span class="sl">12:00</span></div>
<div class="kv"><span>Name</span><b class="inp">James Carter</b><span>Phone</span><b class="inp">+44 7700 900123</b><span>Type</span><b>{chip("Google Meet","fol")}</b></div>
<div class="cbtn">CONFIRM</div><small>Meeting link and confirmation sent automatically</small></div></div>'''

# ---------- 12 Billing (v1.2) ----------
plans=[("Solo","1 agent","AED 99","per user / month",False),("Team","Brokerage · any size","AED 99","per user / month",True),("Enterprise","Large brokerage","Custom","talk to sales",False)]
ph="".join(f'<div class="kpi{" sel" if s_ else ""}" style="{"border-top-color:#b8326f;box-shadow:0 0 0 2px #b8326f inset" if s_ else ""}"><small>{a}</small><b>{c}</b><small>{d}</small><small>{b}</small></div>' for a,b,c,d,s_ in plans)
signup=f'''<div class="duo"><div class="app" style="display:block;padding:16px;background:#fff">
<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">● Estate<b>CRM</b> · Start your 14-day free trial</b><span class="steps"><span class="ok">1 Plan ✓</span><span class="now">2 Company</span><span class="st">3 Verify email</span><span class="st">4 Card</span></span></div>
<div class="two" style="margin-top:12px">
 <div><small class="lbl">CHOOSE A PLAN · PRICES EXCLUDE 5% VAT</small><div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-top:6px">{ph}</div>
  <div class="kv" style="margin-top:10px"><span>Users</span><b class="inp">10</b><span>Billing</span><b>{chip("Monthly","qual")} {chip("Yearly","nr")}</b><span>Estimate</span><b>10 × AED 99 = AED 990 + VAT AED 49.50 / month</b></div></div>
 <div class="card"><small class="lbl">YOUR COMPANY</small>
  <div class="kv"><span>Type</span><b>{chip("Brokerage","qual")} {chip("Individual agent","nr")}</b><span>Company</span><b class="inp">Skyline Realty LLC</b><span>Trade licence no.</span><b class="inp">1234567</b><span>RERA ORN</span><b class="inp">28451</b><span>Licence copy</span><b class="inp">📎 trade-licence.pdf</b><span>Your name</span><b class="inp">Khalid Rahman</b><span>Work email</span><b class="inp">khalid@skyline.ae</b><span>Mobile</span><b class="inp">+971 50 222 3344</b></div>
  <div class="note">Individual agents enter their RERA broker card number (BRN) instead. A card is needed to start the trial; you are charged only after 14 days.</div>
  <div class="acts r">{btn("Continue")}</div></div>
</div></div></div>'''
billing=app("Organization","Organization › Billing",f'''
<div class="tabs"><span class="tab">Profile</span><span class="tab on">Billing</span></div>
<div class="note err">⚠ Payment failed on 1 Nov. Please update your card or pay by bank transfer by <b>15 Nov</b>; after that the CRM becomes read-only. Your data is safe.</div>
<div class="two">
 <div class="card"><small class="lbl">SUBSCRIPTION</small>
  <div class="kv"><span>Plan</span><b>Team · monthly {chip("Payment failed","hot")}</b><span>Seats</span><b>12 of 12 used <u>+ Add seats</u></b><span>Price</span><b>AED 99 per user + 5% VAT</b><span>Next invoice</span><b>1 Dec · AED 1,247.40</b><span>Payment</span><b>Visa •••• 4242 · <u>Change card</u> · <u>Pay by bank transfer</u></b></div>
  <div class="acts">{btn("Change plan","ghost")}{btn("Cancel subscription","ghost")}{btn("Export all data","ghost")}</div></div>
 <div class="card"><small class="lbl">INVOICES (TAX INVOICES, 5% VAT)</small>
  <table class="tbl sm"><thead><tr><th>No.</th><th>Period</th><th>AED</th><th>Status</th><th></th></tr></thead><tbody>
  <tr><td>#000412</td><td>Nov</td><td>1,247.40</td><td>{chip("Unpaid","hot")}</td><td><u>PDF</u> · <u>I paid</u></td></tr>
  <tr><td>#000318</td><td>Oct</td><td>1,039.50</td><td>{chip("Paid","qual")}</td><td><u>PDF</u></td></tr>
  <tr><td>#000201</td><td>Trial</td><td>0.00</td><td>{chip("Trial","fol")}</td><td><u>PDF</u></td></tr></tbody></table>
  <div class="note">Adding 2 seats on 15 Oct added a part-month charge to the next invoice.</div></div>
</div>''')
okp=[("Monthly income","AED 48,906","",),("Paying companies","61",""),("Trials","14",""),("Payment failed","3","red"),("Licence checks","4","")]
okh="".join(f'<div class="kpi {c}"><small>{a}</small><b>{b}</b></div>' for a,b,c in okp)
trows=[("Skyline Realty","Team · 12 seats","Payment failed","hot","Grace ends 15 Nov"),("Sara K. (agent)","Solo · 1 seat","Trial","fol","Ends in 3 days"),("Al Noor Realty","Team · 25 seats","Active","qual","Bank transfer · pending"),("Prime Homes","Enterprise · 80 seats","Active","qual","Custom AED 85"),("Blue Key","Team · 6 seats","Read-only","nr","Unpaid 18 days")]
th="".join(f'<tr><td><b>{a}</b></td><td>{b}</td><td>{chip(c,d)}</td><td><small>{e}</small></td><td><small><u>Open</u> · <u>Extend</u> · <u>Suspend</u></small></td></tr>' for a,b,c,d,e in trows)
owner=f'''<div class="app"><aside class="sb"><div class="logo">● Estate<b>CRM</b> · Owner</div>{"".join(f'<div class="mi{" on" if m=="Companies" else ""}"><span>•</span>{m}</div>' for m in ["Overview","Companies","Licence checks","Bank transfers","Invoices","Plans & prices","Sales enquiries","Settings","Audit log"])}</aside><div class="main"><div class="tb"><div class="tt">Owner console › Companies</div><div class="srch">⌕ Company, email or licence…</div><div class="av">OW</div></div><div class="pg">
<div class="kpis">{okh}</div>
<table class="tbl" style="margin-top:10px"><thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Note</th><th>Actions</th></tr></thead><tbody>{th}</tbody></table>
<div class="note">Our team sees plans, seats, payments and usage only, never a company's leads or messages. Every action is logged.</div></div></div></div>'''
# ---------- 10 Dashboard ----------
kp=[("Total leads","1,284","b"),("New","96","b"),("Untouched","7","r"),("Overdue","12","r"),("Meetings today","9","g"),("Qualified","214","g"),("EOIs","18","p"),("Bookings","11","p"),("Sales value","AED 38.6M","g"),("Unpaid invoices","AED 412K","o")]
kph="".join(f'<div class="kpi {c}"><small>{a}</small><b>{b}</b></div>' for a,b,c in kp)
fun=[("Leads",1284),("Contacted",968),("Qualified",214),("Meeting",96),("EOI",18),("Booking",11),("Sale",7)]
funh="".join(f'<div class="fr"><span>{a}</span><div class="fb" style="width:{max(6,b/1284*100):.0f}%">{b:,}</div></div>' for a,b in fun)
bars="".join(f'<div class="bc"><div class="bv" style="height:{h}%"></div><small>{n}</small></div>' for n,h in [("Sara",90),("Ali",72),("Mira",64),("Omar",48),("John",30)])
dash=app("Dashboard","Dashboard",f'''
<div class="fbar"><span class="f">📅 This month ▾</span><span class="f">Team ▾</span><span class="f">Agent ▾</span><span class="f">Project ▾</span><span class="f">Campaign ▾</span></div>
<div class="kpis">{kph}</div>
<div class="charts">
 <div class="card"><small class="lbl">LEADS BY SOURCE</small><div class="pie"></div><div class="lg"><span class="d1"></span>Meta 46% <span class="d2"></span>Portals 28% <span class="d3"></span>Google 16% <span class="d4"></span>Other 10%</div></div>
 <div class="card"><small class="lbl">FUNNEL</small>{funh}</div>
 <div class="card"><small class="lbl">BOOKINGS BY AGENT</small><div class="bars">{bars}</div></div>
</div><div class="note">Click any number to open the leads behind it. Figures are at most 5 minutes old.</div>''')

# ---------- 11 Integrations ----------
ig=[("Meta lead ads","Al Noor Realty · 2 pages","Connected","qual","2 min ago","412","0"),("WhatsApp (Meta, direct)","+971 4 555 0100","Connected","qual","1 min ago","1,980","3"),("Property Finder","Account #PF-2231","Connected","qual","5 min ago","138","0"),("Bayut","Lead email","Error","hot","3 h ago","96","2"),("Dubizzle","Lead email","Connected","qual","8 min ago","57","0"),("General webhook","Website form + Google Sheet","Connected","qual","4 min ago","203","1"),("Google (Calendar + Meet)","sara@alnoor.ae","Connected","qual","10 min ago","24","0"),("Google Ads","—","Not connected","nr","—","—","—")]
igh="".join(f'<tr><td><b>{a}</b><br><small>{b}</small></td><td>{chip(c,d)}</td><td>{e}</td><td>{f}</td><td class="{"red" if g not in ("0","—") else ""}">{g}</td><td><small><u>Test</u> · <u>Retry</u> · <u>{"Connect" if c=="Not connected" else "Disconnect"}</u></small></td></tr>' for a,b,c,d,e,f,g in ig)
integ=app("Settings & Integrations","Settings & Integrations",f'''
<div class="tabs"><span class="tab on">Connections</span><span class="tab">Stages & reasons</span><span class="tab">Assignment</span><span class="tab">Response time</span><span class="tab">Templates</span><span class="tab">Numbering & currency</span></div>
<table class="tbl"><thead><tr><th>Connection</th><th>Status</th><th>Last sync</th><th>Received</th><th>Failures</th><th>Actions</th></tr></thead><tbody>{igh}</tbody></table>
<div class="note err">Bayut: "Mailbox login failed" since 11:20. 2 leads waiting; they will import automatically once fixed.</div>''')

# ---------- Mobile lead (section 1) ----------
mob=f'''<div class="phone"><div class="pbar">◉ Leads</div><div class="pin left"><div class="tabs sm"><span class="tab on">My</span><span class="tab">Overdue 6</span><span class="tab">New</span></div>
{"".join(f'<div class="mrow"><b>{a}</b><span class="score s{int(e)//34}">{e}</span><br><small>{c} · {h}</small><div>{chip(f,g)}</div></div>' for a,b,c,d,e,f,g,h,i in rows[:4])}</div><div class="pnav">▦ ◉ ▤ ✉ ◷</div></div>'''

W={
"1-screens":[wf("Main screen and lead list","Left menu, lead tabs, filters, saved filter, column chooser, bulk actions and export. Best leads (highest score) at the top.",lead_list),wf("Same screen on a phone","Every screen also works on a phone; agents see their leads with score, stage and next follow-up.",f'<div class="center">{mob}</div>')],
"2-leads":[wf("Lead page","Contact details, sharing, score, projects and deal on the left; stage bar, actions (including Share), next follow-up and the full timeline with the re-enquiry on the right.",lead_page),wf("Re-enquiry","A repeat enquiry goes back to the same agent with a notification; typing an existing lead shows a warning.",dup)],
"3-tasks":[wf("Tasks and calendar","Week view of calls, viewings and meetings. Overdue items in red. Logging a call asks for the outcome and the next action.",tasks),wf("Client booking page (free, replaces Calendly)","Clients pick a free slot from the agent's calendar; a Google Meet or Teams link and confirmation are created automatically.",f'<div class="center">{book}</div>')],
"4-team":[wf("Manage users and roles","Admin turns lead assignment on or off per user and creates custom roles such as Sales, Basic and HR.",team),wf("Manage team and the 10-minute rule","Team hierarchy, and what happens when a new lead is not answered in time.",hier)],
"5-whatsapp":[wf("WhatsApp and email","Conversations with each lead, and a bulk campaign that went through test, manager approval and sending, with its results.",wa)],
"6-projects":[wf("Project and its units","Units are managed inside each project: type, size, view, price and status, with an inventory summary.",proj)],
"7-invoices":[wf("Invoice","Status steps, link to lead, unit and deal, VAT, payments and balance, with full approval history.",inv)],
"8-reports":[wf("Reports","Pick a report, filter, and export. Example: marketing spend and cost per lead.",rp)],
"9-attendance":[wf("Attendance","Phone check-in with live photo; managers approve corrections.",att)],
"10-dashboard":[wf("Dashboard","Number cards, leads by source, sales funnel and bookings by agent. Each role sees its own data.",dash)],
"11-settings":[wf("Settings and integrations","Every connection with its status, last sync, records and failures, plus Test, Retry and Disconnect.",integ)],
"12-subscriptions":[wf("Sign-up and free trial","A brokerage picks a plan and number of users, enters its trade licence and RERA ORN, then confirms its email and saves a card to start the 14-day trial.",signup),wf("Billing (Admin)","Plan, seats used, next invoice, card or bank transfer, tax invoices, and the banner shown when a payment fails.",billing),wf("Owner console (our team only)","All customer companies with plan, seats and payment status; income, trials and licence checks at the top.",owner)],
}
# insert before next h2 after each section
ids=re.findall(r'<h2 id="([^"]+)"',body)
for i,sid in enumerate(ids):
    key=next((k for k in W if sid.startswith(k)),None)
    if not key: continue
    nxt=ids[i+1]
    marker=f'<h2 id="{nxt}"'
    body=body.replace(marker,"".join(W[key])+marker,1)
# hr cleanup
open("body_final.html","w").write(body)
print("ok",len(body))

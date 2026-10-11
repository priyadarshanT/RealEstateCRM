from reportlab.lib.pagesizes import A4
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.lib.enums import TA_RIGHT

INK=colors.HexColor("#14212b"); MUTED=colors.HexColor("#5b6b77"); LINE=colors.HexColor("#dde3e7")
ACC=colors.HexColor("#0d6e6e"); SOFT=colors.HexColor("#e2f1f0"); GOLD=colors.HexColor("#a8741a"); GSOFT=colors.HexColor("#f7eedb")
W,H=A4; M=16*mm; CW=W-2*M

S=lambda **k: ParagraphStyle("x",fontName=k.pop("f","Helvetica"),fontSize=k.pop("s",9.5),leading=k.pop("l",13),textColor=k.pop("c",INK),**k)
h1=S(f="Helvetica-Bold",s=24,l=29); h2=S(f="Helvetica-Bold",s=14,l=18,spaceBefore=6,spaceAfter=6,c=INK)
eyebrow=S(f="Helvetica-Bold",s=8.5,c=ACC); body=S(s=10,l=14.5); muted=S(s=9,l=12.5,c=MUTED)
cell=S(s=8.6,l=11.2); cellb=S(f="Helvetica-Bold",s=8.8,l=11.4); cellm=S(s=8.2,l=10.8,c=MUTED)
num=S(f="Helvetica-Bold",s=8.8,l=11.4,alignment=TA_RIGHT); th=S(f="Helvetica-Bold",s=7.8,l=10,c=MUTED)
thr=S(f="Helvetica-Bold",s=7.8,l=10,c=MUTED,alignment=TA_RIGHT)
P=Paragraph

def footer(c,d):
    c.saveState(); c.setFont("Helvetica",7.5); c.setFillColor(MUTED)
    c.drawString(M,10*mm,"Dubai Real Estate CRM · Technology plan & monthly running cost · v1.2 · 11 October 2026")
    c.drawRightString(W-M,10*mm,f"Page {d.page}"); c.restoreState()

doc=BaseDocTemplate("CRM_Technology_Plan_and_Costs.pdf",pagesize=A4,leftMargin=M,rightMargin=M,topMargin=M,bottomMargin=18*mm,
    title="Dubai Real Estate CRM – Technology Plan and Monthly Cost",author="Solution Architecture")
doc.addPageTemplates([PageTemplate(frames=[Frame(M,18*mm,CW,H-M-18*mm,id="f",leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=footer)])

def tbl(data,widths,total_rows=(),group_rows=()):
    t=Table(data,colWidths=widths,repeatRows=1)
    st=[("VALIGN",(0,0),(-1,-1),"TOP"),("LINEBELOW",(0,0),(-1,-1),0.4,LINE),("LINEBELOW",(0,0),(-1,0),0.8,MUTED),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5)]
    for r in total_rows: st+= [("BACKGROUND",(0,r),(-1,r),SOFT)]
    for r in group_rows: st+= [("BACKGROUND",(0,r),(-1,r),GSOFT),("SPAN",(0,r),(-1,r))]
    t.setStyle(TableStyle(st)); return t

def kpis(items):
    cells=[[P(f'<font size=7.5 color="#5b6b77"><b>{a.upper()}</b></font><br/><font size=17><b>{b}</b></font><br/><font size=8 color="#5b6b77">{c}</font>',S(l=19)) for a,b,c in items]]
    t=Table(cells,colWidths=[CW/len(items)]*len(items))
    t.setStyle(TableStyle([("BOX",(0,0),(-1,-1),0.6,LINE),("INNERGRID",(0,0),(-1,-1),0.6,LINE),("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9),("LEFTPADDING",(0,0),(-1,-1),9)]))
    return t

def diagram():
    d=Drawing(CW,190)
    def box(x,y,w,h,title,sub,fill=colors.white,stroke=ACC):
        d.add(Rect(x,y,w,h,rx=5,ry=5,fillColor=fill,strokeColor=stroke,strokeWidth=1))
        d.add(String(x+w/2,y+h-15,title,fontName="Helvetica-Bold",fontSize=8.5,fillColor=INK,textAnchor="middle"))
        for i,s in enumerate(sub): d.add(String(x+w/2,y+h-27-i*10,s,fontName="Helvetica",fontSize=7.2,fillColor=MUTED,textAnchor="middle"))
    def arrow(x1,y1,x2,y2):
        d.add(Line(x1,y1,x2,y2,strokeColor=MUTED,strokeWidth=1))
        import math; a=math.atan2(y2-y1,x2-x1); L=5
        d.add(Polygon([x2,y2,x2-L*math.cos(a-0.4),y2-L*math.sin(a-0.4),x2-L*math.cos(a+0.4),y2-L*math.sin(a+0.4)],fillColor=MUTED,strokeColor=MUTED))
    box(0,120,110,55,"Users",["Agents, managers,","finance (web + phone)"],fill=SOFT)
    box(140,120,120,55,"Cloudflare",["Security guard &","fast delivery (free)"])
    # AWS region container
    d.add(Rect(285,5,CW-285,180,rx=6,ry=6,fillColor=colors.HexColor("#f6f7f8"),strokeColor=LINE,strokeDasharray=[3,2]))
    d.add(String(295,174,"AWS – Middle East (UAE) region · data stays in the UAE",fontName="Helvetica-Bold",fontSize=7.5,fillColor=ACC))
    bw=(CW-285-30)/2
    box(295,105,bw,55,"App server A",["Data centre 1"]); box(305+bw,105,bw,55,"App server B",["Data centre 2"])
    box(295,20,bw,55,"Main database",["Data centre 1"],fill=SOFT); box(305+bw,20,bw,55,"Standby database",["Live copy, takes over"],fill=SOFT)
    arrow(110,147,140,147); arrow(260,140,295,135)
    d.add(Line(260,160,280,166,strokeColor=MUTED,strokeWidth=1)); d.add(Line(280,166,305+bw*1.5,166,strokeColor=MUTED,strokeWidth=1)); arrow(305+bw*1.5,166,305+bw*1.5,160)
    arrow(295+bw/2,105,295+bw/2,75); arrow(305+bw*1.3,105,295+bw*0.85,75)
    d.add(Line(295+bw,47,305+bw,47,strokeColor=ACC,strokeWidth=1.5,strokeDasharray=[2,2]))
    box(0,10,260,85,"Outside services the CRM talks to",["WhatsApp (Meta) · Facebook / Google / TikTok /","LinkedIn / Snapchat lead forms · Property Finder ·","Bayut · Dubizzle · general webhook · Google / Microsoft","calendars and Meet / Teams · Email (AWS SES)"],fill=GSOFT,stroke=GOLD)
    arrow(260,52,295,52)
    return d

st=[]
st+= [P("TECHNOLOGY PLAN · FOR STAKEHOLDERS",eyebrow),Spacer(1,4),P("Dubai Real Estate CRM:<br/>what it runs on and what it costs",h1),Spacer(1,8),
 P("This document explains, in plain language, every technology service the CRM will use, where it runs, why we need it and what it costs each month. The plan follows the developer requirements brief of 29 September 2026: a desktop- and mobile-friendly CRM for Dubai brokerages, sold to companies (B2B) and individual agents (B2C).",body),Spacer(1,12),
 kpis([("Platform cost","AED 554","per month incl. VAT"),("Budget","AED 1,000","AED 446 to spare"),("Break-even","6 users","at AED 99 per user"),("Data location","UAE","AWS UAE region")]),Spacer(1,14),
 P("The plan in one paragraph",h2),
 P("The CRM runs on Amazon Web Services (AWS) in its UAE region, so client and lead data never leaves the country. Two app servers in two separate data centres share the work; if one fails, the other carries on. The database keeps a live standby copy that takes over automatically within one to two minutes, and is backed up every day. Free services handle security, login, error alerts and code delivery. Everything is built on standard open-source software, so the system can grow to thousands of users, or move to Azure or our own servers later, without being rebuilt.",body),Spacer(1,12),
 P("How it fits together",h2),diagram(),Spacer(1,4),
 P("Both app servers use the main database. The dashed line shows every change being copied to the standby instantly.",muted)]
st.append(PageBreak())

paid=[
("App servers","AWS EC2 (2× t4g.small)","The computers that run the CRM software. Two of them, in two buildings, so one can fail without anyone noticing.","AWS UAE",73),
("Database","AWS RDS PostgreSQL (db.t4g.medium, Multi-AZ)","Where every lead, call, note, invoice and attendance record is kept. A live standby copy takes over automatically if the main one fails.","AWS UAE",272),
("Database storage & backups","AWS gp3 storage + automatic backups","Disk space for the database plus daily backups kept 14 days, so we can restore any moment in that window.","AWS UAE",18),
("Internet addresses","AWS public IPv4 (2)","Lets the servers call WhatsApp, Meta, Google and the portals.","AWS UAE",26),
("File storage","AWS S3","Holds brochures, floor plans, invoice PDFs and attendance photos.","AWS UAE",7),
("Monitoring","AWS CloudWatch","Watches server health and raises an alarm if something looks wrong.","AWS UAE",11),
("Test environment","AWS EC2 Spot, office hours only","A separate copy for testing changes before staff see them (required by the brief).","AWS UAE",11),
("Email sending","AWS SES","Sends reminders, meeting confirmations and reports; receives portal lead emails.","AWS",11),
("Error tracking","Sentry Team","Tells developers instantly when something breaks, with details to fix it fast.","Sentry (EU/US)",95),
("Domain name",".com or .ae","The web address of the CRM.","Registrar",4),
("Card payments","Stripe","Takes subscription payments by card and sends payment updates to the CRM. No monthly fee; about 3% per payment, taken from revenue (section 12).","Stripe",0),
]
rows=[[P("SERVICE",th),P("TECHNOLOGY",th),P("WHAT IT DOES AND WHY WE NEED IT",th),P("WHERE",th),P("AED / MONTH",thr)]]
for a,b,c,d,e in paid: rows.append([P(a,cellb),P(b,cellm),P(c,cell),P(d,cellm),P(f"{e:,}",num)])
tot=sum(x[4] for x in paid); vat=round(tot*0.05)
rows+= [[P("Total before VAT",cellb),"","","",P(f"{tot:,}",num)],[P("UAE VAT 5%",cell),"","","",P(f"{vat:,}",num)],[P("<b>Total per month</b>",S(f="Helvetica-Bold",s=10)),"","","",P(f"<b>AED {tot+vat:,}</b>",S(f="Helvetica-Bold",s=10,alignment=TA_RIGHT))]]
n=len(rows)
st+= [P("1. Paid services",h2),P("Prices are list prices in October 2026, converted at 1 USD = 3.6725 AED. Servers and database are on 1-year commitments, which cut their price by roughly a third.",muted),Spacer(1,6),
 tbl(rows,[30*mm,33*mm,CW-30*mm-33*mm-20*mm-19*mm,20*mm,19*mm],total_rows=(n-3,n-2,n-1))]
assert tot+vat==554, tot+vat
st.append(PageBreak())

free=[
("Security & speed","Cloudflare Free + Cloudflare Tunnel","Stands in front of the CRM: blocks attacks, provides the padlock (SSL), serves images fast and sends visitors to whichever server is healthy."),
("Login & two-factor","AWS Cognito","Secure sign-in with a code from an authenticator app. Free up to 10,000 active users a month."),
("Background jobs","pg-boss (inside the database)","Sends reminders, escalates untouched leads and retries failed syncs in the background, without an extra server."),
("Uptime alerts","Better Stack Free","Checks every few minutes that the CRM is reachable and alerts the team if not."),
("Code storage & delivery","GitHub Free + GitHub Actions","Keeps the source code (owned by the company) and releases tested updates automatically."),
("Maps","Google Maps Platform (free allowance)","Shows project and unit locations."),
("Phone notifications","Firebase Cloud Messaging","Pushes reminders and alerts to agents' phones."),
("General webhook","Built into the CRM","One secure link that any system can send leads to: website, Google Sheets, Excel (Power Automate) or Make.com."),
("Online meetings","Google Meet / Microsoft Teams","Meeting links created from the agent's connected Google or Microsoft account. Replaces Zoom."),
("Client booking page","Built into the CRM","Clients pick a free slot in the agent's calendar. Replaces Calendly."),
("PDFs & Excel","Gotenberg, ExcelJS (open source)","Creates invoice and purchase-order PDFs and Excel report exports on our own servers."),
("Lead sources","Meta, Google Ads, LinkedIn, TikTok, Snapchat APIs","Bring ad leads straight into the CRM, with campaign and form details. Free to connect; ad spend is separate."),
("Property portals","Property Finder, Bayut, Dubizzle","Leads arrive through each account's authorized method (partner API, webhook or lead email). Confirm API access per account."),
("Calendars","Google Calendar, Microsoft 365","Two-way calendar sync for agents. Uses the brokerage's existing accounts."),
]
rows=[[P("SERVICE",th),P("TECHNOLOGY",th),P("WHAT IT DOES AND WHY WE NEED IT",th)]]+[[P(a,cellb),P(b,cellm),P(c,cell)] for a,b,c in free]
st+= [P("2. Free services (AED 0)",h2),P("These cost nothing at our size. Each has a paid tier we can switch on later if needed.",muted),Spacer(1,6),
 tbl(rows,[32*mm,45*mm,CW-77*mm])]
st+= [Spacer(1,10),P("3. Paid by each brokerage on its own accounts",h2),P("The brief asks to <i>connect</i> these, meaning the brokerage's existing subscriptions. They are not part of our monthly cost.",muted),Spacer(1,6)]
rows=[[P("SERVICE",th),P("WHY",th),P("TYPICAL COST TO THE BROKERAGE",th)],
 [P("Zoom, Calendly, respond.io",cellb),P("Not needed. Meetings use free Google Meet / Teams links, clients book through the CRM's own booking page, and WhatsApp connects directly to Meta.",cell),P("AED 0",cell)]]
st.append(tbl(rows,[38*mm,CW-38*mm-45*mm,45*mm]))
st.append(PageBreak())

st+= [P("4. Software the CRM is built with",h2),P("All open source: no licence fees, no lock-in to one vendor, and the company owns the code.",muted),Spacer(1,6)]
rows=[[P("PART",th),P("TECHNOLOGY",th),P("WHY THIS CHOICE",th)],
 [P("Screens (web & phone)",cellb),P("Next.js (React, TypeScript)",cellm),P("One app for desktop and mobile. Installs on phones like an app, including camera check-in for attendance, without app-store fees.",cell)],
 [P("Business logic",cellb),P("NestJS (Node.js, TypeScript)",cellm),P("Organised into modules: leads, tasks, WhatsApp/email, projects, invoices, attendance, reports, integrations. Any module can become its own service later.",cell)],
 [P("Data",cellb),P("PostgreSQL 16",cellm),P("Reliable, industry-standard database. Keeps each brokerage's data separate, stores original ad-form answers, and powers search and duplicate detection.",cell)],
 [P("Packaging & setup",cellb),P("Docker, Terraform",cellm),P("The whole system is described as code, so test and live environments are identical and can be rebuilt or moved quickly.",cell)]]
st.append(tbl(rows,[34*mm,40*mm,CW-74*mm]))
st+= [Spacer(1,10),P("5. What stakeholders can count on",h2)]
promises=[("Always on","Two servers in two data centres plus a standby database. A failure in one building does not stop the CRM."),
("Data safety","Daily backups, restore to any moment in the last 14 days, all data encrypted, every change recorded in an audit log."),
("Security","Two-factor login, role-based permissions from Director to Agent, attack protection by Cloudflare, data kept in the UAE."),
("Speed","Lead lists open in under a second; heavy reports and Excel exports run in the background so screens stay fast."),
("Ownership","The company owns the data, source code, database design and documentation, as the brief requires.")]
rows=[[P(a,cellb),P(b,cell)] for a,b in promises]
t=Table(rows,colWidths=[30*mm,CW-30*mm]); t.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LINEBELOW",(0,0),(-1,-1),0.4,LINE),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),("LEFTPADDING",(0,0),(-1,-1),5)]))
st.append(t)
st+= [Spacer(1,10),P("6. How cost grows with the business",h2),P("We only upgrade when a trigger is reached. Each step is a settings change, not a rebuild. Platform cost only; integrations are billed to brokerages (section 10). Growth uses AWS's managed database for simplicity; the lean design used at 1 million users is cheaper but needs more hands-on operation.",muted),Spacer(1,6)]
rows=[[P("STAGE",th),P("SIZE",th),P("WHAT WE ADD",th),P("AED / MONTH",thr)],
 [P("Launch",cellb),P("1 brokerage, up to ~150 users",cell),P("This plan",cell),P("≈ 554",num)],
 [P("Growth",cellb),P("10 brokerages, ~500 users",cell),P("Larger servers and database, small cache server",cell),P("≈ 1,508",num)],
 [P("1 million users",cellb),P("Mostly buyers and tenants, ~20,000 active a day",cell),P("Lean design (section 14): Cloudflare caching, self-run database, self-hosted login and maps, 3-year commitments",cell),P("≈ 1,281",num)]]
st.append(tbl(rows,[24*mm,46*mm,CW-24*mm-46*mm-26*mm,26*mm]))
st.append(PageBreak())

st+= [P("7. Why AWS, and not Azure or our own servers",h2)]
rows=[[P("OPTION",th),P("MONTHLY COST",th),P("VERDICT",th)],
 [P("AWS, UAE region (recommended)",cellb),P("≈ AED 554",cell),P("Meets budget with automatic database failover. Widest choice of services as we grow.",cell)],
 [P("Microsoft Azure, UAE North",cellb),P("≈ AED 1,100–1,150",cell),P("About 3× more because its cheapest database tier has no standby copy. Worth revisiting at large scale: Azure has two UAE regions (Dubai and Abu Dhabi) for in-country disaster recovery and strong ties with government and Microsoft-based enterprises.",cell)],
 [P("Own servers (on-premise)",cellb),P("≈ AED 5,000–12,000",cell),P("Needs 3 servers, two internet lines, backup power and a system administrator. WhatsApp and ad lead feeds still come from the cloud. Possible later because the software is open source.",cell)]]
st.append(tbl(rows,[42*mm,32*mm,CW-74*mm]))
st+= [Spacer(1,10),P("8. One-off costs (not monthly)",h2)]
for x in ["Security penetration test before go-live: about AED 15,000–40,000, usually once a year.","UAE SMS sender ID registration, only if SMS is added later.","Native iPhone / Android apps, only if needed: Apple AED 364 a year, Google AED 92 once.","Data migration from the current CRM and staff training (part of the development quote)."]:
    st.append(P("• "+x,body))
st+= [Spacer(1,10),P("9. Assumptions and notes",h2)]
for x in ["Launch size: one brokerage, about 50 users and 5,000 new leads a month, of which about 60% never respond.",
"AWS amounts are estimates from public list prices for the UAE region; confirm in the AWS Pricing Calculator before signing.",
"WhatsApp rates are indicative UAE rates (about USD 0.015 per reminder, USD 0.0385 per marketing message); confirm on Meta's live rate card.",
"Not included: developer salaries, advertising spend, and card fees when collecting subscriptions (Stripe UAE 2.9% + AED 1 per payment).",
"Servers and database are on 1-year commitments. Monthly pay-as-you-go would add about AED 150 a month."]:
    st.append(P("• "+x,body))

st.append(PageBreak())
R=3.6725
def aed(usd): return round(usd*R)
st+= [P("10. Third-party integrations and lead rules",h2),
 P("<b>WhatsApp is now paid by each customer company directly to Meta</b>: every brokerage or agent connects its own WhatsApp Business account and Meta bills them. Zoom, Calendly and respond.io have been removed. Stripe card fees are taken from revenue (section 12). So our only running cost is the platform. The lead rules below (10-minute rule, re-enquiry, sharing, scoring) run on the servers we already pay for.",body),Spacer(1,8)]
rows=[[P("ITEM (LAUNCH: 50 USERS, 5,000 LEADS A MONTH)",th),P("AED / MONTH",thr)]]
items=[("Platform (page 2): servers, database, backups, email, monitoring, error tracking",528),
("WhatsApp messages (paid by each company directly to Meta)",0),
("Card payment fees (Stripe, about 3%, deducted from revenue)",0)]
for a,b in items: rows.append([P(a,cell),P(f"{b:,}",num)])
t1=sum(b for _,b in items); v1=round(t1*0.05)
rows+=[[P("Total before VAT",cellb),P(f"{t1:,}",num)],[P("UAE VAT 5%",cell),P(f"{v1:,}",num)],[P("<b>Total per month, all-in</b>",S(f="Helvetica-Bold",s=10)),P(f"<b>AED {t1+v1:,}</b>",S(f="Helvetica-Bold",s=10,alignment=TA_RIGHT))]]
n=len(rows); st.append(tbl(rows,[CW-28*mm,28*mm],total_rows=(n-3,n-2,n-1)))
assert t1+v1==554
st+= [Spacer(1,6),P("Example of what a brokerage pays Meta itself: a welcome WhatsApp to 5,000 new leads a month is about AED 290, follow-up templates about AED 150. Replies within 24 hours of a customer's message are free.",muted),Spacer(1,10)]
rules=[("10-minute rule","A new lead not acted on within 10 minutes (adjustable) moves to the next available agent in the team. If every agent in the team misses it, the lead goes back to the <b>Admin</b>, who sees the full history and decides."),
("Re-enquiry","A repeat enquiry from an existing contact is added to the existing lead and stays with the same agent, who is notified \"Re-enquired\". No duplicate leads."),
("Lead sharing","The owner or a manager can share a lead with other users as \"View only\" or \"Can edit\"."),
("Focus on potential","Each lead gets a score from 0 to 100 (budget, project match, source quality, engagement). Best leads show first. Leads are never closed automatically; the brokerage team decides.")]
t=Table([[P(a,cellb),P(b,cell)] for a,b in rules],colWidths=[34*mm,CW-34*mm]); t.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LINEBELOW",(0,0),(-1,-1),0.4,LINE),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),("LEFTPADDING",(0,0),(-1,-1),5)]))
st+= [P("Lead rules agreed with stakeholders",S(f="Helvetica-Bold",s=11,l=15,spaceAfter=4)),t,Spacer(1,6),
 P("Meta decides whether a follow-up is billed as a utility or a marketing message; follow-ups are priced here at the higher marketing rate.",muted)]


# ---------- 11 Development cost ----------
st.append(PageBreak())
st+= [P("11. Development cost and timeline",h2),
 P("The CRM is designed and built in-house by the solution architect, so there is <b>no development cost</b>. The company still owns the code, database design and documentation, as the brief requires.",body),Spacer(1,8)]
ph=[("Phase 1","Core: leads, lead tabs, re-enquiry, sharing, 10-minute rule, tasks & calendar, team hierarchy & permissions, dashboard, reports & Excel export, Excel/CSV import, Meta lead ads, subscriptions, billing, sign-up and owner console","Months 1–5"),
("Phase 2","Communications & integrations: WhatsApp, email & campaigns, consent/opt-out, Google/LinkedIn/TikTok/Snapchat, Property Finder, Bayut & Dubizzle, general webhook, booking page, calendars, connection screen, Meta reconciliation","Months 6–9"),
("Phase 3","Projects & units, deals, invoices, purchase orders & payments, commissions, attendance with photo check-in","Months 10–12")]
rows=[[P("PHASE",th),P("WHAT IS DELIVERED",th),P("WHEN (ONE DEVELOPER)",th),P("COST",thr)]]
for x,y,z in ph: rows.append([P(x,cellb),P(y,cell),P(z,cellm),P("AED 0",num)])
rows.append([P("Total",cellb),P("About 12 months; version 1 launches with all three phases (SRS v1.2)",cell),"",P("<b>AED 0</b>",num)])
st.append(tbl(rows,[18*mm,CW-18*mm-34*mm-20*mm,34*mm,20*mm],total_rows=(len(rows)-1,)))
st+= [Spacer(1,10),P("Keeping a one-person build safe",S(f="Helvetica-Bold",s=11,l=15,spaceAfter=4))]
for x in ["Code lives in the company's GitHub account, not on a personal laptop.",
 "Automated tests and Terraform mean another developer can take over or join quickly.",
 "Short written documentation for each module, plus the API documentation the brief requires.",
 "Still budget for an external penetration test before go-live (AED 15,000–40,000, one-off), since nobody should test their own security alone."]:
    st.append(P("• "+x,body))
st+= [Spacer(1,4),P("Running costs (page 2) start at go-live, about AED 554 a month.",muted)]

# ---------- 12 Revenue ----------
st.append(PageBreak())
st+= [P("12. Revenue and break-even (example)",h2),
 P("Agreed pricing: <b>AED 99 per user per month</b> on every plan (Solo, Team; Enterprise at a custom price), excluding 5% VAT. VAT collected is paid to the tax authority, so it is not revenue. Each company pays Meta for its own WhatsApp. Revenue below is after about 3% Stripe card fees.",body),Spacer(1,8)]
p500=aed(60)+aed(145)+aed(28)+aed(28)+aed(13)+aed(20)+aed(15)+aed(20)+aed(50)+aed(11)+aed(1)
def v(x): return round(x*1.05)
sc=[(50,554),(200,1100),(500,v(p500)),(1000,round(v(p500)*1.8))]
rows=[[P("PAYING USERS",th),P("REVENUE",thr),P("PLATFORM COST",thr),P("MONTHLY PROFIT",thr)]]
for u,c in sc:
    r=round(u*99*0.97); pr=r-c
    rows.append([P(f"{u:,}",cellb),P(f"{r:,}",num),P(f"{c:,}",num),P(f"{pr:,}",num)])
st.append(tbl(rows,[30*mm]+[(CW-30*mm)/3]*3))
st+= [Spacer(1,6),P("All amounts in AED per month, excluding VAT on revenue. Platform cost for 200 and 1,000 users is estimated between the launch and 500-user figures. With no development cost there is no build investment to repay. Profit is before sales, support and marketing staff.",muted),Spacer(1,10),
 P("What this means",S(f="Helvetica-Bold",s=11,l=15,spaceAfter=4))]
for x in ["Running costs are covered by the first <b>6 paying users</b>.",
 f"At <b>500 users</b> (about 10 brokerages) the platform earns about AED {round(500*99*0.97)-v(p500):,} a month after running costs.",
 "Each extra user adds about AED 90 a month of profit, because running cost per user keeps falling as the platform grows.",
 "The 14-day trial needs a card, so trials turn into paying users automatically unless cancelled."]:
    st.append(P("• "+x,body))

# ---------- 13 Checklist ----------
st+= [Spacer(1,12),P("13. To confirm before final sign-off",h2),P("These items turn the estimates in this document into confirmed numbers.",muted),Spacer(1,6)]
chk=[("AWS running cost","Enter this plan in the AWS Pricing Calculator for the UAE region","Architect"),
("Stripe account","Open a Stripe UAE account under the trade licence; confirm card fee rates","Management"),
("Yearly price","Confirm yearly price (draft AED 990 per user, 2 months free)","Management"),
("Property Finder, Bayut & Dubizzle","Confirm API, webhook or lead-email access for the brokerage's accounts","Brokerage + architect"),
("Ad platform access","Start Meta app review and LinkedIn lead-sync partner approval (takes weeks)","Architect"),
("Open SRS items","Confirm items marked \"to confirm\" in SRS v1.2","Stakeholder"),
("Terms and privacy","Terms of Service and Privacy Policy for customers (UAE lawyer)","Legal"),
("Data protection","Legal review against the UAE data protection law (PDPL)","Legal"),
("Launch date","Agree the go-live date for version 1 (all phases)","Management + architect"),
("Penetration test","Get a quote from a UAE security firm","Architect")]
rows=[[P("ITEM",th),P("ACTION",th),P("OWNER",th),P("STATUS",th)]]+[[P(a,cellb),P(b,cell),P(c,cellm),P("To do",cellm)] for a,b,c in chk]
st.append(tbl(rows,[36*mm,CW-36*mm-34*mm-20*mm,34*mm,20*mm]))


# ---------- 14 Lean 1M ----------
st.append(PageBreak())
st+= [P("14. Design for 1 million users at low cost",h2),
 P("A million users in Dubai real estate would be mostly buyers and tenants browsing listings, with a few thousand agents doing the heavy work. If about 2% are active each day (20,000 people), the servers receive only around 12 requests a second, because Cloudflare answers most page views from its cache. The design below keeps the platform close to the AED 1,000 budget while data stays in the UAE.",body),Spacer(1,8)]
L=[("Cloudflare caching for all public pages and images","About 95% of visits never reach our servers","Cloudflare",0),
("Property images and brochures in Cloudflare R2 (2 TB)","No fee each time an image is viewed. Private files (invoices, attendance photos) stay in AWS UAE","Cloudflare",110),
("2 app servers, 3-year commitment","About 60% cheaper than monthly pricing; still two data centres","AWS UAE",260),
("PostgreSQL run by us on 2 servers with a live standby (Patroni)","About half the cost of AWS's managed database; automatic failover kept","AWS UAE",735),
("Self-hosted login (Keycloak)","Cognito would charge about AED 54,000 a month at 1 million users","AWS UAE",0),
("OpenStreetMap maps (MapLibre)","No fee per map view; Google Maps would charge per load","AWS UAE",0),
("Phone push notifications first, email only when needed","Push is free; email is charged per message","Firebase / AWS",75),
("Backups to cold storage; old activity archived","Keeps the live database small and cheap","AWS UAE",40)]
rows=[[P("DESIGN CHOICE",th),P("WHY IT SAVES",th),P("WHERE",th),P("AED / MONTH",thr)]]
for a,b,c_,d in L: rows.append([P(a,cellb),P(b,cell),P(c_,cellm),P(f"{d:,}" if d else "0",num)])
lt=sum(x[3] for x in L); lv=round(lt*0.05)
rows+=[[P("Total before VAT",cellb),"","",P(f"{lt:,}",num)],[P("UAE VAT 5%",cell),"","",P(f"{lv:,}",num)],[P("<b>Platform cost per month at 1 million users</b>",S(f="Helvetica-Bold",s=10)),"","",P(f"<b>AED {lt+lv:,}</b>",S(f="Helvetica-Bold",s=10,alignment=TA_RIGHT))]]
n=len(rows); st.append(tbl(rows,[56*mm,CW-56*mm-24*mm-22*mm,24*mm,22*mm],total_rows=(n-3,n-2,n-1)))
assert lt+lv==1281
st+= [Spacer(1,10),P("What design cannot remove",S(f="Helvetica-Bold",s=11,l=15,spaceAfter=4))]
for x in ["<b>WhatsApp:</b> Meta charges for every message. One message to each of a million people is about AED 55,000, so messaging is billed to the brokerage that sends it.",
 "<b>Heavy agent use:</b> if a million people all worked in the CRM like agents, data, email and server load would grow far beyond this budget.",
 "<b>Hosting outside the UAE</b> (for example dedicated servers in Germany) could bring the platform under AED 1,000, but client data would leave the UAE."]:
    st.append(P("• "+x,body))
st+= [Spacer(1,8),P("Trade-off: we run the database ourselves, including failover and backups. This is reliable with good automation and monitoring, but adds operating work for a one-person team.",muted)]

# ---------- 15 Brief coverage ----------
st.append(PageBreak())
st+= [P("15. Coverage of the requirements brief",h2),P("Every section of the developer requirements brief (29 September 2026), the technology that delivers it, and the phase it ships in.",muted),Spacer(1,6)]
cov=[("1 Layout & navigation","Next.js screens: left menu, lead tabs, global search, saved filters, configurable columns, bulk actions, role-based export","1"),
("2 Leads","Leads module; PostgreSQL stores original form answers and source IDs; duplicate detection and merge; full timeline; configurable stages with reasons","1"),
("3 Tasks, calls, meetings","Tasks module; reminders; 10-minute rule (next agent, then Admin); Google Meet / Teams links; built-in booking page; Google / Microsoft calendar sync; client time zones","1 (tasks) · 2"),
("4 Team & permissions","Director → Agent hierarchy, Admin and Finance roles; per-action permissions; round-robin and rule-based assignment; reassignment log","1"),
("5 WhatsApp & email","WhatsApp Cloud API directly with Meta, AWS SES; templates, bulk audiences, delivery statuses; consent and opt-out suppression","2"),
("6 Projects & listings","Developer, project, building and unit records; images and brochures in file storage; unit status and price history","3"),
("7 Invoices & purchase orders","Finance module; PDF generation (Gotenberg); approval workflow, payments, balances, commissions; full audit","3"),
("8 Reports & exports","Reports module; Excel/CSV exports matching on-screen totals; Meta lead reconciliation; export log","1 · 2"),
("9 Attendance","Phone check-in with live photo and optional location; office hours and leave rules; correction approvals with audit trail","3"),
("10 Dashboard","Role-based dashboards, pie, funnel, column and line charts, KPI cards; every number opens its records","1"),
("11 Configuration & integrations","Connection screen per source: status, last sync, failures, test, retry; general webhook with field mapping; Dubizzle added; portal access confirmed per account","2"),
("12 Security & delivery","Two-factor login, encryption, daily backups, audit logs, separate staging; company owns code, schema, API docs; training","All"),
("Added: stakeholder rules","Lead score 0–100, re-enquiry to previous agent, lead sharing, custom roles, Admin-only exports (section 10)","1")]
rows=[[P("BRIEF SECTION",th),P("HOW IT IS DELIVERED",th),P("PHASE",th)]]+[[P(a,cellb),P(b,cell),P(c_,cellm)] for a,b,c_ in cov]
st.append(tbl(rows,[40*mm,CW-40*mm-22*mm,22*mm]))
st+= [Spacer(1,6),P("Section 12 of the brief also asks for recurring third-party costs (sections 1–3 and 10 of this document), direct versus provider-based integrations (section 3) and separate phase quotes (section 11).",muted)]
# Conclusion
st.append(PageBreak())
# 500 users (10 brokerages x 50 agents, 50,000 leads/month)
p500=aed(60)+aed(145)+aed(28)+aed(28)+aed(13)+aed(20)+aed(15)+aed(20)+aed(50)+aed(11)+aed(1)
tp500=aed(750)+aed(385)+aed(150)
# 1M users (20,000 agents + ~980,000 buyers/tenants, 400,000 leads/month)
p1m=1220
tp1m=aed(6000)+aed(3080)+aed(1200)
cols=[("Launch",528,416,50),("500 users",p500,tp500,500),("1 million users",p1m,tp1m,1000000)]
def v(x): return round(x*1.05)
st+= [P("16. Conclusion: final monthly cost",h2),
 P("All figures in AED per month including 5% VAT. \"Platform\" is what we pay to run the CRM. \"WhatsApp\" is shown for information only: each company pays Meta directly, so our own cost is the platform line.",muted),Spacer(1,8)]
hdr=[P("",th)]+[P(c[0].upper(),thr) for c in cols]
rows=[hdr,
 [P("Who is using it",cellb)]+[P(x,S(s=8.2,l=10.8,c=MUTED,alignment=TA_RIGHT)) for x in ["1 brokerage, 50 users, 5,000 leads","10 brokerages, 500 users, 50,000 leads","Mostly buyers and tenants, ~20,000 active a day, 400,000 leads"]],
 [P("<b>Platform (our cost)</b>",cell)]+[P(f"{v(c[1]):,}",num) for c in cols],
 [P("WhatsApp (paid by companies to Meta)",cell)]+[P(f"{v(c[2]):,}",num) for c in cols],
 [P("<b>Total incl. WhatsApp</b>",S(f="Helvetica-Bold",s=10))]+[P(f"<b>AED {v(c[1])+v(c[2]):,}</b>",S(f="Helvetica-Bold",s=10.5,alignment=TA_RIGHT)) for c in cols],
 [P("Platform cost per user",cell)]+[P(f"AED {v(c[1])/c[3]:.2f}" if v(c[1])/c[3]>=0.01 else "under AED 0.01",num) for c in cols]]
t=tbl(rows,[42*mm]+[(CW-42*mm)/3]*3,total_rows=(2,)); st.append(t)
print("500:",v(p500),v(tp500),v(p500)+v(tp500)," 1M:",v(p1m),v(tp1m),v(p1m)+v(tp1m))
st+= [Spacer(1,12),P("What changes at each size",S(f="Helvetica-Bold",s=11,l=15,spaceAfter=4))]
for x in [
 "<b>500 users:</b> larger app servers and database, a small cache server, more email and error-tracking volume. Same design as launch; no rebuild.",
 "<b>1 million users:</b> the lean design in section 14: Cloudflare caching, image storage with no viewing fees, our own database servers with a live standby, self-hosted login and maps, and 3-year commitments.",
 "Cost per user falls sharply with scale because the core platform is shared by every brokerage and buyer."]:
    st.append(P("• "+x,body))
st+= [Spacer(1,12),P("Bottom line",S(f="Helvetica-Bold",s=11,l=15,spaceAfter=4)),
 P(f"Our own monthly platform cost is <b>AED 554</b> at launch, <b>AED {v(p500):,}</b> at 500 users and about <b>AED {v(p1m):,}</b> at one million users, with data staying in the UAE. The 500-user figure still uses AWS's managed database; moving to the lean design at that point would bring it close to AED 1,000 as well. WhatsApp is paid by each company directly to Meta, so it never appears on our costs. Zoom, Calendly and respond.io are no longer needed. The one-million figure assumes mostly occasional users and should be re-checked before that scale.",body),Spacer(1,8),
 P(f"Development is done in-house at <b>no cost</b>, over about 12 months, and version 1 launches with every feature. At AED 99 per user a month, running costs are covered by the first <b>6 paying users</b>, and at 500 users the CRM earns about AED {round(500*99*0.97)-v(p500):,} a month after running costs.",body)]

doc.build(st)

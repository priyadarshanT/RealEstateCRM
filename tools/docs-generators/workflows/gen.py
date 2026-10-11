import subprocess, html
STY='''graph [rankdir=TB, fontname="Helvetica", fontsize=11, bgcolor="transparent", nodesep=0.35, ranksep=0.42, pad=0.2];
node [fontname="Helvetica", fontsize=11, shape=box, style="rounded,filled", fillcolor="#e3f5f2", color="#0d9488", penwidth=1.3, margin="0.14,0.07"];
edge [fontname="Helvetica", fontsize=9.5, color="#5d6d78", arrowsize=0.7, fontcolor="#36505b"];'''
S='shape=oval, fillcolor="#0d9488", fontcolor="white", color="#0b6b62"'          # start
E='shape=oval, fillcolor="#1f2d36", fontcolor="white", color="#1f2d36"'          # end
D='shape=diamond, fillcolor="#fff1d6", color="#e39a00", margin="0.04,0.04"'       # decision
A='fillcolor="#e1ecff", color="#3b6fe0"'                                           # automatic / system
N='fillcolor="#efe5ff", color="#8b5cf6"'                                           # notification
U='fillcolor="#e3f5f2", color="#0d9488"'                                           # user action
R='fillcolor="#ffe4e0", color="#d93a2f"'                                           # stop / reject
G='fillcolor="#dcf6e8", color="#1f9d63"'                                           # success
W={}

W["lifecycle"]=("Lead lifecycle (stages)","The path a lead takes from first enquiry to Won, Lost or Invalid. Stages are configurable; leads are never closed automatically.",f'''
graph [rankdir=LR, ranksep=0.5];
new [label="New", {A}]; pending [label="Pending", {U}]; attempted [label="Attempted", {U}]; nr [label="No Response\\n(Cold tab)", {U}];
fu [label="Follow-up", {U}]; warm [label="Warm", {U}]; hot [label="Hot", {U}]; qual [label="Qualified", {U}];
meet [label="Meeting\\nScheduled", {U}]; view [label="Viewing\\nScheduled", {U}]; eoi [label="EOI\\nSubmitted", {U}]; booked [label="Booked", {U}];
won [label="Won", {G}, penwidth=2]; lost [label="Lost\\n(agent chooses, reason required)", {R}, penwidth=2]; invalid [label="Invalid\\n(reason required)", {R}, penwidth=2];
new -> pending [label="assigned"]; pending -> attempted [label="call, no answer"]; attempted -> nr [label="still no answer"];
pending -> fu [label="contacted"]; attempted -> fu [label="contacted"]; nr -> fu [label="replies"];
fu -> warm; warm -> hot; hot -> qual; fu -> qual [label="clear need\\n+ budget"];
qual -> meet; qual -> view; meet -> view; meet -> eoi; view -> eoi; eoi -> booked [label="deal booking"]; booked -> won [label="sale"];
{{rank=same; lost; invalid}}
fu -> lost [style=dashed, label="agent decides\\n(any open stage)"]; pending -> invalid [style=dashed, label="wrong number,\\nspam"];
lost -> fu [label="REOPEN\\nre-enquiry", color="#1f9d63", fontcolor="#1f9d63", style=bold];
''')

W["intake"]=("New lead intake and re-enquiry check","Same steps for every source: Meta, Property Finder, Bayut, Dubizzle, website, general webhook (e.g. Google Sheets), WhatsApp, Excel import, manual entry.",f'''
s [label="Enquiry arrives\\n(webhook, portal, import row\\nor manual entry)", {S}];
sig [label="Signature valid?", {D}]; rej [label="Reject (401)\\nlog attempt", {R}];
save [label="Save raw event", {A}];
seen [label="Same submission ID\\nalready imported?", {D}]; ign [label="Ignore\\n(no double import)", {R}];
fetch [label="Fetch full details\\nform answers, campaign,\\nad set, ad, form IDs", {A}];
norm [label="Clean data\\nphone → +971…, email → lower case", {A}];
match [label="Phone or email matches\\nan existing lead?", {D}];
create [label="Create new lead\\n+ enquiry (original answers)", {A}];
reenq [label="Re-enquiry workflow\\n(add to existing lead)", {N}, penwidth=2];
assign [label="Assignment workflow", {U}, penwidth=2];
fail [label="Error? retry 5× with\\nincreasing delay → show on\\nIntegrations screen", {R}, style="rounded,filled,dashed"];
done [label="Lead in CRM", {E}];
s -> sig; sig -> rej [label="no"]; sig -> save [label="yes"]; save -> seen; seen -> ign [label="yes"]; seen -> fetch [label="no"];
fetch -> norm; norm -> match; match -> create [label="no"]; match -> reenq [label="yes"]; create -> assign; assign -> done; reenq -> done;
fetch -> fail [style=dashed, color="#d93a2f"];
''')

W["reenquiry"]=("Re-enquiry (repeat enquiry from an existing contact)","No duplicate leads: the enquiry joins the existing lead and goes back to the same agent.",f'''
s [label="Enquiry matches an existing\\nlead (same phone or email)", {S}];
add [label="Add enquiry to existing lead\\ntimeline: Re-enquired via [source]", {A}];
closed [label="Lead was Lost\\nor Invalid?", {D}];
reopen [label="Reopen in Follow-up", {G}];
act [label="Previous agent active and\\nreceiving leads?", {D}];
same [label="Stays with previous agent", {G}];
notify [label="Notify agent:\\nRe-enquired via [source]", {N}];
rules [label="Assign by normal rules\\n(new owner notified)", {A}];
manual [label="Agent typing a lead that exists\\nsees: already exists, owned by X\\n→ open existing lead", {N}, style="rounded,filled,dashed"];
e [label="Done", {E}];
s -> add -> closed; closed -> reopen [label="yes"]; closed -> act [label="no"]; reopen -> act;
act -> same [label="yes"]; act -> rules [label="no"]; same -> notify -> e; rules -> e;
''')
W["share"]=("Sharing a lead with another user","The owner keeps the lead; others can help on it.",f'''
s [label="Owner or manager opens\\nthe lead page", {S}];
pick [label="Click Share, choose user(s)", {U}];
lvl [label="Access level?", {D}];
view [label="View only:\\nsee details and timeline", {U}];
edit [label="Can edit:\\nnotes, calls, tasks,\\nmessages, stage", {U}];
tab [label="Lead appears in their\\nShared with Me tab", {N}];
log [label="Share logged\\n(who, with whom, when)", {A}];
rm [label="Remove sharing\\nany time (logged)", {R}, style="rounded,filled,dashed"];
note [label="Only owner and managers\\ncan reassign or delete", {A}];
e [label="Done", {E}];
s -> pick -> lvl; lvl -> view [label="view only"]; lvl -> edit [label="can edit"]; view -> tab; edit -> tab; tab -> log -> note -> e; log -> rm [style=dashed];
''')

W["assign"]=("Lead assignment","Rules are checked top to bottom; the first match wins. Round-robin gives each available agent the next lead in turn.",f'''
s [label="New lead to assign", {S}];
rule [label="Next active rule\\n(by priority)", {A}];
m [label="Lead matches rule?\\nproject, campaign, source,\\nlanguage, location", {D}];
more [label="More rules?", {D}];
pool [label="Agent pool =\\nrule's team or members", {A}];
avail [label="Remove unavailable agents\\n(on leave, Receives leads off,\\ninactive)", {A}];
any [label="Anyone left?", {D}];
rr [label="Pick next agent after the\\nlast one assigned (round-robin)", {A}];
set [label="Set owner + team\\nstage New → Pending\\nlog assignment", {G}];
notify [label="Notify agent\\n(in-app + push)", {N}];
timer [label="Start 10-minute timer", {A}];
un [label="Unassigned queue\\nmanagers assign by hand", {R}];
e [label="Done", {E}];
s -> rule -> m; m -> pool [label="yes"]; m -> more [label="no"]; more -> rule [label="yes"]; more -> un [label="no"];
pool -> avail -> any; any -> rr [label="yes"]; any -> more [label="no"];
rr -> set -> notify -> timer -> e; un -> e;
''')

W["escalation"]=("10-minute rule: lead not answered","Time is a setting (10 minutes by default). Any logged action by the agent (call, note, message, stage change) counts as a response.",f'''
s [label="New lead assigned\\nto an agent", {S}];
act [label="Agent acted within\\n10 minutes?", {D}];
ok [label="Lead stays with agent\\nresponse time recorded", {G}];
log [label="Log: No response from agent\\nagent informed", {N}];
next [label="Another agent in the team\\nnot yet tried and available?", {D}];
move [label="Move lead to next agent\\n(new 10 minutes)", {A}];
admin [label="Lead goes back to Admin\\nAdmin is owner, notified,\\nsees full history", {R}, penwidth=2];
dec [label="Admin works the lead or\\nassigns it to anyone", {U}];
e [label="Done", {E}];
s -> act; act -> ok [label="yes"]; act -> log [label="no"]; log -> next; next -> move [label="yes"]; move -> act; next -> admin [label="no, whole\\nteam missed"]; admin -> dec -> e; ok -> e;
''')


W["call"]=("Call and follow-up loop","Every call ends with an outcome and a next action, so no lead is left without a follow-up date.",f'''
s [label="Call task due\\n(reminder sent before)", {S}];
call [label="Agent calls the lead", {U}];
out [label="Outcome?", {D}];
ans [label="Answered:\\nnote + update stage", {G}];
na [label="No answer / Busy:\\nattempt counted", {U}];
wr [label="Wrong number:\\nmove to Invalid (reason)", {R}];
cb [label="Call back requested", {U}];
next [label="Set next action\\n(date, time, type, reminder)", {U}];
upd [label="Lead next follow-up updated\\ncall added to timeline", {A}];
od [label="Next follow-up passes\\nwithout action?", {D}];
alert [label="Overdue alert to agent\\nlead appears in Overdue tab", {N}];
e [label="Done", {E}];
s -> call -> out; out -> ans [label="answered"]; out -> na [label="no answer / busy"]; out -> wr [label="wrong number"]; out -> cb [label="call back"];
ans -> next; na -> next; cb -> next; next -> upd -> od; od -> alert [label="yes"]; od -> e [label="no"]; wr -> e; alert -> e;
''')

W["meeting"]=("Meeting and viewing booking","Agents book from the lead page, or clients book themselves on the CRM booking page. Free Google Meet / Teams links replace Zoom and Calendly.",f'''
a [label="Agent books from lead page", {S}]; c [label="Client books on the\\nCRM booking page", {S}];
slot [label="Agent free at that time?", {D}]; busy [label="Rejected: choose\\nanother time", {R}];
kind [label="Online?", {D}];
link [label="Create Google Meet or\\nMicrosoft Teams link", {A}];
save [label="Save meeting + task\\nstage → Meeting / Viewing Scheduled", {G}];
cal [label="Add to agent\'s Google /\\nMicrosoft calendar", {A}];
conf [label="Send confirmation to client\\n(email, or WhatsApp if consented)\\nin client\'s time zone", {N}];
chg [label="Rescheduled or cancelled?", {D}];
upd [label="Update meeting, calendar,\\ntimeline; notify both sides", {A}];
after [label="After meeting:\\nagent marks Completed / No-show\\n+ next action", {U}];
e [label="Done", {E}];
a -> slot; c -> slot; slot -> busy [label="no"]; slot -> kind [label="yes"]; kind -> link [label="yes"]; kind -> save [label="viewing /\\nin person"];
link -> save -> cal -> conf -> chg; chg -> upd [label="yes"]; upd -> conf; chg -> after [label="no"]; after -> e;
''')

W["campaign"]=("Bulk WhatsApp / email campaign","Two people are always involved: the creator cannot approve their own campaign.",f'''
s [label="Manager creates campaign", {S}];
aud [label="Choose audience (lead filter)\\n+ approved template + schedule", {U}];
excl [label="Remove opted-out contacts\\nshow final count", {A}];
test [label="Send test message", {U}];
sub [label="Submit for approval", {U}];
appr [label="Approver (GM / Director)\\napproves?", {D}];
rej [label="Rejected with note\\nback to draft", {R}];
send [label="At scheduled time:\\nsend in batches", {A}];
st [label="Track: sent, delivered,\\nfailed, replied, opted out", {A}];
opt [label="Recipient opts out?", {D}];
sup [label="Record opt-out\\nnever messaged again", {R}];
rep [label="Campaign report", {G}];
e [label="Done", {E}];
s -> aud -> excl -> test -> sub -> appr; appr -> rej [label="no"]; rej -> aud; appr -> send [label="yes"]; send -> st -> opt;
opt -> sup [label="yes"]; opt -> rep [label="no"]; sup -> rep; rep -> e;
''')

W["deal"]=("Deal and unit status","A deal links a lead to one unit. The unit's status follows the deal; a unit can only be booked by one deal.",f'''
graph [rankdir=LR];
subgraph cluster_d {{ label="Deal"; fontname="Helvetica-Bold"; color="#0d9488"; style="rounded,dashed";
 offer [label="Offer", {U}]; eoi [label="EOI\\n(deposit, date)", {U}]; book [label="Booking\\n(unit required)", {U}]; sold [label="Sold\\n(sale value, date)", {G}]; canc [label="Cancelled\\n(reason)", {R}];
 offer -> eoi -> book -> sold; offer -> canc [style=dashed]; eoi -> canc [style=dashed]; book -> canc [style=dashed]; }}
subgraph cluster_u {{ label="Unit"; fontname="Helvetica-Bold"; color="#8b5cf6"; style="rounded,dashed";
 av [label="Available", {G}]; hold [label="On Hold\\n(expires)", {D}, shape=box]; bk [label="Booked", {N}]; sd [label="Sold", {E}, shape=box];
 av -> hold [label="EOI"]; hold -> bk [label="booking"]; bk -> sd [label="sale"]; hold -> av [label="expired /\\ncancelled", style=dashed]; bk -> av [label="cancelled", style=dashed]; }}
eoi -> hold [style=dotted, color="#8b5cf6", label="updates"]; book -> bk [style=dotted, color="#8b5cf6"]; sold -> sd [style=dotted, color="#8b5cf6"];
''')

W["invoice"]=("Invoice and purchase order approval","Only drafts can be edited. After approval, a document is never changed: it is cancelled and reissued.",f'''
s [label="Finance creates document\\n(sales invoice, purchase\\ninvoice or PO)", {S}];
draft [label="Draft\\nedit lines, VAT, links to\\nlead, unit, deal", {U}];
ap [label="Director / Finance\\napproves?", {D}];
num [label="Approved\\nnumber assigned (INV-2026-0042)\\nPDF generated, amounts frozen", {G}];
sent [label="Sent to client /\\ndeveloper / vendor", {A}];
po [label="Purchase order?", {D}];
podone [label="PO stays Sent until a\\npurchase invoice settles it", {E}];
pay [label="Payment recorded?", {D}];
part [label="Partially Paid", {U}];
paid [label="Paid", {G}];
due [label="Past due date\\nand unpaid?", {D}];
od [label="Overdue\\n(alert Finance)", {R}];
ref [label="Refund recorded → Refunded", {R}];
canc [label="Cancelled (reason)\\nreissue if needed", {R}];
s -> draft -> ap; ap -> draft [label="changes\\nneeded"]; ap -> num [label="yes"]; num -> sent -> po; po -> podone [label="yes"]; po -> pay [label="no"];
pay -> part [label="part"]; pay -> paid [label="full"]; pay -> due [label="none yet"]; part -> pay; due -> od [label="yes"]; od -> pay;
paid -> ref [style=dashed, label="refund"]; num -> canc [style=dashed, label="cancel"];
''')

W["attendance"]=("Attendance check-in and corrections","Original entries are never overwritten: a correction keeps a copy of the original and records who approved it.",f'''
s [label="Employee opens app\\non working day", {S}];
photo [label="Take live photo\\n(+ location if enabled)", {U}];
cin [label="Check In", {U}];
late [label="After start + grace?", {D}];
pr [label="Present", {G}]; lt [label="Late", {D}, shape=box];
cout [label="Check Out (photo)", {U}];
half [label="Worked ≤ half-day\\nlimit?", {D}]; hd [label="Half Day", {U}];
night [label="Nightly: no check-in,\\nno leave, not holiday", {A}]; ab [label="Absent", {R}];
corr [label="Employee requests\\ncorrection with reason", {U}];
mgr [label="Manager approves?", {D}];
apply [label="Record updated, original\\nsaved, audit logged", {G}]; keep [label="Record unchanged", {R}];
s -> photo -> cin -> late; late -> lt [label="yes"]; late -> pr [label="no"]; pr -> cout; lt -> cout; cout -> half; half -> hd [label="yes"];
night -> ab; ab -> corr [style=dashed]; lt -> corr [style=dashed]; corr -> mgr; mgr -> apply [label="yes"]; mgr -> keep [label="no"];
''')

W["leave"]=("Leave request","Approved leave makes the agent unavailable for new leads on those days.",f'''
s [label="Employee requests leave\\n(type, dates, half day?)", {S}];
ov [label="Overlaps approved leave?", {D}]; blk [label="Blocked", {R}];
mgr [label="Manager approves?\\n(not own request)", {D}];
ok [label="Approved", {G}]; no [label="Rejected (note)", {R}];
av [label="Agent skipped by\\nlead assignment on those days", {A}];
att [label="Attendance marked Leave", {A}];
e [label="Done", {E}];
s -> ov; ov -> blk [label="yes"]; ov -> mgr [label="no"]; mgr -> ok [label="yes"]; mgr -> no [label="no"]; ok -> av -> att -> e; no -> e;
''')

W["export"]=("Report export","Only Admin can export leads, reports and attendance. Exports match the screen and are always logged.",f'''
s [label="User opens report\\nand sets filters", {S}];
perm [label="User is Admin?\\n(or role given export)", {D}]; hide [label="Export button hidden", {R}];
size [label="More than 5,000 rows?", {D}];
now [label="Download Excel / CSV\\nimmediately", {G}];
bg [label="Build in background", {A}]; ready [label="Notify: file ready", {N}];
log [label="Export log: user, report,\\nfilters, format, rows, time", {A}];
e [label="Done", {E}];
s -> perm; perm -> hide [label="no"]; perm -> size [label="yes"]; size -> now [label="no"]; size -> bg [label="yes"]; bg -> ready;
now -> log; ready -> log; log -> e;
''')

W["signup"]=("Sign-up and free trial","How a new agent or brokerage becomes a customer online. Enterprise customers go through our sales team instead.",f'''
s [label="Visitor opens pricing page\\nand picks Solo or Team", {S}];
form [label="Enters company, users,\\nmonthly / yearly", {U}];
typ [label="Brokerage or\\nindividual agent?", {D}];
bro [label="Trade licence no.\\n+ RERA ORN required", {U}]; ind [label="RERA broker card\\n(BRN) required", {U}];
mail [label="Confirms email\\n(6-digit code)", {U}];
card [label="Saves a card with Stripe\\n(required for the trial)", {U}];
ok [label="Card saved?", {D}]; stop [label="Cannot start trial", {R}];
create [label="Company created: Admin user,\\ndefault roles, stages, settings\\n14-day trial starts", {A}];
check [label="Our team checks\\nlicence / RERA number", {N}];
ver [label="Verified?", {D}]; wa [label="WhatsApp can\\nnow be connected", {G}]; fix [label="Customer asked to\\ncorrect the details", {R}];
remind [label="Reminder 3 days and\\n1 day before trial ends", {N}];
end [label="Trial ends", {D}];
paid [label="First charge by card\\n→ Active, tax invoice sent", {G}];
canc [label="Cancelled during trial\\n→ no charge", {E}];
s -> form -> typ; typ -> bro [label="brokerage"]; typ -> ind [label="agent"]; bro -> mail; ind -> mail; mail -> card -> ok;
ok -> stop [label="no"]; ok -> create [label="yes"]; create -> check -> ver; ver -> wa [label="yes"]; ver -> fix [label="no"];
create -> remind -> end; end -> paid [label="continues"]; end -> canc [label="cancelled"];
''')

W["dunning"]=("Payment failed: grace period and read-only","What happens when a subscription payment does not go through. Data is never deleted while a company is unpaid.",f'''
s [label="Renewal date\\n(monthly or yearly)", {S}];
how [label="Pays by?", {D}];
charge [label="Stripe charges the card", {A}];
inv [label="Invoice emailed with\\nour bank details", {A}];
ref [label="Admin enters transfer\\nreference + receipt", {U}];
conf [label="Our team confirms\\nmoney received", {U}];
ok [label="Paid?", {D}];
active [label="Active\\ntax invoice (5% VAT)", {G}];
pd [label="Payment failed\\nbanner + email to Admin\\n14-day grace starts", {N}];
rem [label="Reminders during grace;\\neverything still works", {N}];
paid2 [label="Paid within 14 days?", {D}];
ro [label="Read-only: view and export only;\\nnew leads still saved", {R}, penwidth=2];
pay [label="Admin pays\\n(card or transfer)", {U}];
re [label="Reactivated at once", {G}];
s -> how; how -> charge [label="card"]; how -> inv [label="transfer"]; inv -> ref -> conf -> ok; charge -> ok;
ok -> active [label="yes"]; ok -> pd [label="no"]; pd -> rem -> paid2; paid2 -> active [label="yes"]; paid2 -> ro [label="no"];
ro -> pay -> re;
''')

W["cancel"]=("Cancelling a subscription","The customer can leave at any time and take their data with them.",f'''
s [label="Admin clicks\\nCancel subscription", {S}];
keep [label="CRM keeps working until\\nthe end of the paid period\\n(no refund for started period)", {A}];
undo [label="Admin changes mind\\nbefore the period ends?", {D}];
res [label="Cancellation undone", {G}];
end [label="Period ends:\\nlogin closed, data kept 90 days", {A}];
exp [label="Admin can still export\\nall data for 90 days", {U}];
del [label="Day 90: company data\\ndeleted permanently", {E}];
s -> keep -> undo; undo -> res [label="yes"]; undo -> end [label="no"]; end -> exp -> del;
''')

out={}
for k,(t,c,body) in W.items():
    src="digraph G {\n"+STY+"\n"+body+"\n}"
    open(f"{k}.dot","w").write(src)
    r=subprocess.run(["dot","-Tsvg",f"{k}.dot"],capture_output=True,text=True)
    if r.returncode: print("ERR",k,r.stderr); continue
    svg=r.stdout[r.stdout.index("<svg"):]
    out[k]=(t,c,svg)
import json; json.dump({k:list(v) for k,v in out.items()},open("svgs.json","w"))
print("ok",len(out))

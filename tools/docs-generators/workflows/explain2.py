exec(open("explain.py").read())
X["lifecycle"]=("Every buyer enquiry moves through steps, from first contact to the sale, like a customer walking further into a showroom. Leads are never closed automatically; the agent decides.",
X["lifecycle"][1].replace("He doesn't answer twice (<b>Attempted</b>), then calls back","He doesn't answer twice (<b>Attempted</b>), then calls back"),
X["lifecycle"][2])
X["intake"]=("Whenever someone asks about a property, from any ad, portal (Property Finder, Bayut, Dubizzle), WhatsApp, the website or a Google Sheet through the general webhook, the CRM catches it within a minute, cleans the details and checks if we already know this person.",
"Priya fills a form for Sobha Hartland on the website, which sends it to the CRM through the general webhook. Her details are cleaned (+971 format), the original answers are saved, and because her number is new, a new lead is created and sent to the assignment step.",
"No lead is lost or imported twice, and every source, even ones without a ready-made connection, can feed the CRM.")
X["reenquiry"]=("If a known buyer enquires again, no second lead is created. The enquiry is added to their existing lead and goes straight back to the agent who already knows them.",
"Priya, already Sara's client, enquires again about Sobha Hartland on Dubizzle. The CRM recognises her phone number, adds the enquiry to her lead and sends Sara a notification: \"Re-enquired via Dubizzle\". If Priya had been marked Lost, her lead reopens in Follow-up. If Sara had left the company, the lead would go to a new agent by the normal rules.",
"The buyer always deals with the same agent, no two agents chase the same person, and agents get a timely signal that an old buyer is active again.")
X["share"]=("An agent or manager can let a colleague see or work on a lead, without giving the lead away.",
"Sara owns Ahmed's lead. Ahmed now wants a Russian-speaking colleague to join a call with his partner, so Sara shares the lead with Mira as \"Can edit\". Mira sees it in her Shared with Me tab, logs her call and notes. Sara stays the owner, and can remove Mira's access any time.",
"Teamwork on big deals without confusion about who owns the buyer, and every share is recorded.")
X["assign"]=(X["assign"][0].replace("Agents on leave are skipped.","Agents on leave, or whose \"Receives leads\" switch is off, are skipped."),X["assign"][1],X["assign"][2])
X["escalation"]=("A new lead must be acted on within 10 minutes. If the agent doesn't act, it moves to the next agent in the team. If the whole team misses it, it goes back to the Admin.",
"A Bayut lead for Damac Lagoons arrives at 10:00 and goes to Ali. No call by 10:10, so it moves to Mira. Nothing by 10:20, so it moves to John. Nothing by 10:30: the whole team (3 agents) has missed it, so it goes back to the Admin, who sees the full history (who missed it and when) and decides who handles it.",
"In Dubai real estate, the first agent to call usually wins the buyer. This protects expensive ad leads, and the history shows management which agents keep missing leads.")
del X["autoclose"]
X["meeting"]=("Meetings and property viewings can be booked by the agent or by the client on the CRM's own booking page. Online links (Google Meet or Teams), calendar entries and confirmations are created automatically, with no Zoom or Calendly subscription. An agent can never be booked twice at the same time.",
"James, a UK investor, opens Sara's booking page and picks Tuesday 10 AM Dubai time. The CRM creates a Google Meet link, adds it to Sara's calendar and sends James a confirmation showing 7 AM London time. If James moves it to Wednesday, everything updates on both sides.",
"Overseas buyers book easily across time zones, no meeting is missed or double-booked, and the brokerage saves the cost of Zoom and Calendly licences.")
X["export"]=("Leads, reports and attendance can be downloaded as Excel or CSV only by the Admin, and every download is recorded.",
"The Admin downloads September's marketing report: AED 53,150 spent, 646 leads, AED 82 per lead. The Excel totals match the screen exactly. The log shows who exported it, when, and with which filter. Agents and managers can view reports on screen but cannot download them.",
"Company data cannot leave the system without the Admin, which protects the client database and meets data protection rules.")

X["signup"]=("A new customer can sign up on our website on their own, try the CRM free for 14 days, and become a paying customer without anyone from our side having to set things up.",
"Khalid runs Skyline Realty, a brokerage with 10 agents. He picks the Team plan for 10 users, enters his trade licence and RERA ORN, confirms his email and saves the company card. Skyline's CRM is ready in two minutes, with Khalid as Admin. Our team checks the licence the same day, so Khalid can connect WhatsApp. Two days before the trial ends he gets a reminder; on day 15 the card is charged AED 1,039.50 (10 × AED 99 + 5% VAT) and a tax invoice arrives by email.",
"Customers can start any time, even at night, and the CRM sells itself. Asking for the licence and RERA number keeps out fake accounts, and the card requirement means trials turn into paying customers.")
X["dunning"]=("If a payment does not go through, the customer gets 14 days to pay while everything keeps working. After that the CRM becomes read-only until they pay. Nothing is ever deleted.",
"Skyline's card expires and the November charge fails. Khalid sees a red banner and gets an email. He is busy with a launch and forgets. After 14 days the CRM becomes read-only: agents can still open leads and export, and new Bayut leads are still saved, but nobody can add notes or send WhatsApp messages. Khalid pays by bank transfer, enters the reference, our team confirms it, and the CRM is fully back within minutes.",
"We get paid without chasing customers by phone, and customers are treated fairly: plenty of warning, no lost data, and instant reactivation.")
X["cancel"]=("A customer can cancel at any time. They keep using the CRM until the end of what they paid for, and can download all their data for 90 days afterwards.",
"Sara, an independent agent on the Solo plan, joins a large brokerage and cancels on 10 March. Her CRM works until 31 March, the end of her paid month. In April she downloads all her leads and history as Excel files. On 29 June her data is deleted permanently.",
"Customers trust a product they can leave easily, and the UAE data protection law is respected: data is not kept longer than needed.")

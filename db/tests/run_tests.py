"""Runs the 54 database rule tests. Needs the sample data (tests/sample_data.sql) loaded.
Settings come from environment variables: PGPASSWORD (required), PGHOST, PGPORT, PGUSER, PGDATABASE, PSQL."""
import subprocess
A="aaaaaaaa-0000-0000-0000-000000000001"; B="bbbbbbbb-0000-0000-0000-000000000001"
import os, shutil, sys
PSQL=os.environ.get("PSQL") or shutil.which("psql") or r"C:\Program Files\PostgreSQL\16\bin\psql.exe"
HOST=os.environ.get("PGHOST","localhost"); PORT=os.environ.get("PGPORT","5432")
USER=os.environ.get("PGUSER","postgres"); DB=os.environ.get("PGDATABASE","crm_dev")
if not os.environ.get("PGPASSWORD"): print("Set PGPASSWORD to your postgres password first."); sys.exit(1)
def run(sql, as_app=False, tenant=None):
    pre="BEGIN;"
    if as_app: pre+="SET LOCAL ROLE crm_app;"
    if tenant: pre+=f"SET LOCAL app.tenant_id='{tenant}';"
    r=subprocess.run([PSQL,"-h",HOST,"-p",PORT,"-U",USER,"-d",DB,"-tA","-v","ON_ERROR_STOP=1","-c",pre+sql+";ROLLBACK;"],capture_output=True,text=True)
    return r.returncode, (r.stdout+r.stderr).strip()
STG=lambda key,t=A: f"(SELECT id FROM lead_stages WHERE tenant_id='{t}' AND key='{key}')"
tests=[
("Tenant A user sees only tenant A leads","SELECT count(*) FROM leads",True,A,"ok","1"),
("No tenant set: sees nothing","SELECT count(*) FROM leads",True,None,"ok","0"),
("Tenant A cannot insert a row for tenant B",f"INSERT INTO lead_sources (tenant_id,type,name) VALUES ('{B}','manual','x')",True,A,"err","row-level security"),
("Tenant A cannot read tenant B's lead by ID","SELECT count(*) FROM leads WHERE id='b2000000-0000-0000-0000-000000000001'",True,A,"ok","0"),
("Lead cannot point to another tenant's user",f"UPDATE leads SET owner_user_id='b0000000-0000-0000-0000-00000000000a' WHERE id='a2000000-0000-0000-0000-000000000001'",False,None,"err","foreign key"),
("Same submission cannot be imported twice",f"INSERT INTO lead_inquiries (tenant_id,lead_id,source_id,external_submission_id,submitted_at) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','META-123',now())",True,A,"err","lead_inquiries_submission_uq"),
("Status category must match the status",f"UPDATE leads SET stage_id={STG('cold')}, stage_category='open' WHERE id='a2000000-0000-0000-0000-000000000001'",True,A,"err","foreign key"),
("Cold requires a substatus",f"UPDATE leads SET stage_id={STG('cold')}, stage_category='lost', closed_at=now() WHERE id='a2000000-0000-0000-0000-000000000001'",True,A,"err","check constraint"),
("Cold with a substatus is accepted",f"UPDATE leads SET stage_id={STG('cold')}, stage_category='lost', closed_at=now(), substatus_id=(SELECT id FROM lead_substatuses WHERE tenant_id='{A}' AND name='Not Interested') WHERE id='a2000000-0000-0000-0000-000000000001'",True,A,"ok",""),
("Substatus must belong to the lead's status",f"UPDATE leads SET substatus_id=(SELECT id FROM lead_substatuses WHERE tenant_id='{A}' AND name='Not Interested') WHERE id='a2000000-0000-0000-0000-000000000001'",True,A,"err","foreign key"),
("Substatus names are unique per status",f"INSERT INTO lead_substatuses (tenant_id,stage_id,name,sort_order) VALUES ('{A}',{STG('hot')},'zoom schedule',9)",True,A,"err","lead_substatuses_name_uq"),
("Tenant A cannot see tenant B's substatuses",f"SELECT count(*) FROM lead_substatuses WHERE tenant_id='{B}'",True,A,"ok","0"),
("Open assigned lead must have a next follow-up","UPDATE leads SET next_follow_up_at=NULL WHERE id='a2000000-0000-0000-0000-000000000001'",True,A,"err","check constraint"),
("Response deadline only when the lead has an owner","UPDATE leads SET owner_user_id=NULL, assigned_at=NULL, response_due_at=now() WHERE id='a2000000-0000-0000-0000-000000000001'",True,A,"err","check constraint"),
("10-minute rule move is logged (no_response)",f"INSERT INTO lead_assignments (tenant_id,lead_id,from_user_id,to_user_id,method,reason_id) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','a0000000-0000-0000-0000-00000000000d','no_response',(SELECT id FROM reasons WHERE tenant_id='{A}' AND key='no_response'))",True,A,"ok",""),
("Admin fallback is logged",f"INSERT INTO lead_assignments (tenant_id,lead_id,from_user_id,to_user_id,method,reason_id) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-00000000000a','admin_fallback',(SELECT id FROM reasons WHERE tenant_id='{A}' AND key='admin_fallback'))",True,A,"ok",""),
("Manual reassignment needs a reason",f"INSERT INTO lead_assignments (tenant_id,lead_id,from_user_id,to_user_id,method) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','a0000000-0000-0000-0000-00000000000d','manual')",True,A,"err","check constraint"),
("Lead can be shared as 'edit'",f"INSERT INTO lead_shares (tenant_id,lead_id,user_id,access,shared_by) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000d','edit','a0000000-0000-0000-0000-00000000000c')",True,A,"ok",""),
("Share access must be view or edit",f"INSERT INTO lead_shares (tenant_id,lead_id,user_id,access,shared_by) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000d','owner','a0000000-0000-0000-0000-00000000000c')",True,A,"err","check constraint"),
("Agent cannot be double-booked",f"INSERT INTO meetings (tenant_id,lead_id,organizer_user_id,type,channel,join_url,starts_at,ends_at) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','meeting','google_meet','https://meet.google.com/x','2026-11-01 10:00+04','2026-11-01 11:00+04'),('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','viewing','in_person',NULL,'2026-11-01 10:30+04','2026-11-01 11:30+04')",True,A,"err","exclusion constraint"),
("Booking-page meeting must reference a booking page",f"INSERT INTO meetings (tenant_id,lead_id,organizer_user_id,type,channel,join_url,booked_via,starts_at,ends_at) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','meeting','google_meet','https://meet.google.com/x','booking_page','2026-11-02 10:00+04','2026-11-02 10:30+04')",True,A,"err","check constraint"),
("Zoom is no longer an allowed channel",f"INSERT INTO meetings (tenant_id,lead_id,organizer_user_id,type,channel,join_url,starts_at,ends_at) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','meeting','zoom','https://zoom.us/x','2026-11-03 10:00+04','2026-11-03 10:30+04')",True,A,"err","check constraint"),
("Deal unit must belong to the deal's project",f"INSERT INTO deals (tenant_id,lead_id,project_id,unit_id,owner_user_id) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c')",True,A,"err","foreign key"),
("A unit cannot be booked by two deals",f"INSERT INTO deals (tenant_id,lead_id,project_id,unit_id,owner_user_id,stage,booking_date) VALUES ('{A}','a2000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000c','booking',current_date),('{A}','a2000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000d','booking',current_date)",True,A,"err","deals_one_booking_per_unit_uq"),
("Invoice total and balance are calculated","SELECT total||'/'||balance FROM finance_documents WHERE id='a7000000-0000-0000-0000-000000000001'",True,A,"ok","68250.00/68250.00"),
("Draft invoice cannot be 'paid' without approval","UPDATE finance_documents SET status='paid' WHERE id='a7000000-0000-0000-0000-000000000001'",True,A,"err","check constraint"),
("Approved invoice amounts are frozen","UPDATE finance_documents SET status='approved', number='INV-2026-0001', approved_by='a0000000-0000-0000-0000-00000000000a', approved_at=now() WHERE id='a7000000-0000-0000-0000-000000000001'; UPDATE finance_documents SET subtotal=1 WHERE id='a7000000-0000-0000-0000-000000000001'",True,A,"err","cannot be edited"),
("Lines of an approved invoice cannot change","UPDATE finance_documents SET status='approved', number='INV-2026-0001', approved_by='a0000000-0000-0000-0000-00000000000a', approved_at=now() WHERE id='a7000000-0000-0000-0000-000000000001'; UPDATE finance_document_lines SET unit_price=1",True,A,"err","only change while the document is draft"),
("Purchase order cannot be 'paid'",f"INSERT INTO finance_documents (tenant_id,doc_type,counterparty_id,issue_date,currency,created_by,status,number,approved_by,approved_at) VALUES ('{A}','purchase_order','a6000000-0000-0000-0000-000000000001',current_date,'AED','a0000000-0000-0000-0000-00000000000a','paid','PO-1','a0000000-0000-0000-0000-00000000000a',now())",True,A,"err","check constraint"),
("History is append-only (audit log)",f"INSERT INTO audit_logs (tenant_id,action,entity_type) VALUES ('{A}','create','leads'); UPDATE audit_logs SET action='delete'",True,A,"err","permission denied"),
("Enquiries cannot be edited","UPDATE lead_inquiries SET form_answers='{}'",True,A,"err","permission denied"),
("Overlapping approved leave is blocked",f"INSERT INTO leave_requests (tenant_id,user_id,leave_type_id,start_date,end_date,status,reviewed_by) VALUES ('{A}','a0000000-0000-0000-0000-00000000000c','a8000000-0000-0000-0000-000000000001','2026-10-20','2026-10-24','approved','a0000000-0000-0000-0000-00000000000b'),('{A}','a0000000-0000-0000-0000-00000000000c','a8000000-0000-0000-0000-000000000001','2026-10-23','2026-10-25','approved','a0000000-0000-0000-0000-00000000000b')",True,A,"err","exclusion constraint"),
("Nobody approves their own leave",f"INSERT INTO leave_requests (tenant_id,user_id,leave_type_id,start_date,end_date,status,reviewed_by) VALUES ('{A}','a0000000-0000-0000-0000-00000000000c','a8000000-0000-0000-0000-000000000001','2026-12-01','2026-12-02','approved','a0000000-0000-0000-0000-00000000000c')",True,A,"err","check constraint"),
("A file attaches to exactly one record",f"INSERT INTO files (id,tenant_id,storage_key,file_name,mime_type,size_bytes) VALUES ('a9000000-0000-0000-0000-000000000001','{A}','k1','a.pdf','application/pdf',10); INSERT INTO attachments (tenant_id,file_id,category,lead_id,project_id) VALUES ('{A}','a9000000-0000-0000-0000-000000000001','document','a2000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001')",True,A,"err","check constraint"),
("Only Admin has export permissions (default)",f"SELECT string_agg(r.key,',' ORDER BY r.key) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE rp.permission_key='leads.export'",True,A,"ok","admin"),
("Admin can switch off lead assignment for a user","UPDATE users SET receives_leads=false WHERE id='a0000000-0000-0000-0000-00000000000d' RETURNING receives_leads",True,A,"ok","f"),
("Active users cannot exceed paid seats",f"INSERT INTO users (tenant_id,email,full_name,role_id,status) VALUES ('{A}','new@a.ae','New',(SELECT id FROM roles WHERE tenant_id='{A}' AND key='sales_agent'),'active')",True,A,"err","Seat limit reached"),
("Invited (not active) users don't use a seat",f"INSERT INTO users (tenant_id,email,full_name,role_id,status) VALUES ('{A}','inv@a.ae','Invited',(SELECT id FROM roles WHERE tenant_id='{A}' AND key='sales_agent'),'invited') RETURNING status",True,A,"ok","invited"),
("Seats cannot drop below active users","UPDATE subscriptions SET seats=2",True,A,"err","Cannot reduce seats"),
("Admin can add seats","UPDATE subscriptions SET seats=6 RETURNING seats",True,A,"ok","6"),
("Tenant cannot change its own billing status","UPDATE subscriptions SET status='active'",True,A,"err","permission denied"),
("Tenant cannot mark itself verified","UPDATE tenants SET verification_status='verified', verified_at=now()",True,A,"err","permission denied"),
("Tenant cannot create its own invoices or payments",f"INSERT INTO billing_payments (tenant_id,invoice_id,method,amount,bank_reference) VALUES ('{A}','ac000000-0000-0000-0000-000000000001','bank_transfer',415.80,'TT-1')",True,A,"err","permission denied"),
("Tenant sees only its own subscription invoices","SELECT count(*) FROM billing_invoices",True,B,"ok","0"),
("Trial needs a card on file",f"UPDATE subscriptions SET status='trialing', trial_ends_at=now()+interval '14 days', card_on_file=false WHERE tenant_id='{A}'",False,None,"err","check constraint"),
("Payment failure needs a grace end date",f"UPDATE subscriptions SET status='past_due' WHERE tenant_id='{A}'",False,None,"err","check constraint"),
("Cancelled subscription has a data deletion date",f"UPDATE subscriptions SET status='canceled', canceled_at=now() WHERE tenant_id='{A}'",False,None,"err","check constraint"),
("Bank transfer counts only when confirmed by the platform team",f"INSERT INTO billing_payments (tenant_id,invoice_id,method,status,amount,bank_reference,received_at) VALUES ('{A}','ac000000-0000-0000-0000-000000000001','bank_transfer','succeeded',415.80,'TT-1',now())",False,None,"err","check constraint"),
("Invoice VAT total is calculated (AED 396 + 5%)","SELECT total FROM billing_invoices",True,A,"ok","415.80"),
("Issued subscription invoice cannot be edited","UPDATE billing_invoices SET subtotal=1",False,None,"err","cannot be edited"),
("Brokerage needs trade licence and RERA ORN","INSERT INTO tenants (type,name) VALUES ('brokerage','No licence LLC')",False,None,"err","check constraint"),
("Individual agent needs RERA broker card (BRN)","INSERT INTO tenants (type,name) VALUES ('individual','Sara K')",False,None,"err","check constraint"),
("Subscription history is append-only",f"INSERT INTO subscription_events (tenant_id,subscription_id,type,actor_type) VALUES ('{A}','ab000000-0000-0000-0000-000000000001','seats_changed','system'); UPDATE subscription_events SET note='x'",True,A,"err","permission denied"),
("App cannot see platform admins","SELECT count(*) FROM platform_admins",True,A,"err","permission denied"),
]
ok=0; rows=[]
for name,sql,app,t,exp,needle in tests:
    code,out=run(sql,app,t)
    passed = (code==0 and (needle in out)) if exp=="ok" else (code!=0 and needle.lower() in out.lower())
    ok+=passed; rows.append((name,"PASS" if passed else "FAIL", "" if passed else out[:200]))
for r in rows: print(f"{r[1]}  {r[0]}  {r[2]}")
print(f"\n{ok}/{len(tests)} passed")


import yaml, json, re, collections
def ref(n): return {"$ref":f"#/components/schemas/{n}"}
def arr(s): return {"type":"array","items":s}
def page(s): return {"type":"object","required":["data","page"],"properties":{"data":arr(s),"page":ref("PageInfo")}}
S={}  # schemas
def obj(name, props, required=(), desc=None):
    o={"type":"object","properties":props}
    if required: o["required"]=list(required)
    if desc: o["description"]=desc
    S[name]=o; return ref(name)
U={"type":"string","format":"uuid"}; Ur={"type":"string","format":"uuid","readOnly":True}
T={"type":"string","format":"date-time"}; Tr={"type":"string","format":"date-time","readOnly":True}
D={"type":"string","format":"date"}
STR={"type":"string"}; INT={"type":"integer"}; BOOL={"type":"boolean"}
MONEY={"type":"string","pattern":r"^-?\d+(\.\d{1,2})?$","description":"Decimal as string, 2 places","example":"3250000.00"}
CUR={"type":"string","pattern":"^[A-Z]{3}$","example":"AED"}
PHONE={"type":"string","pattern":r"^\+[1-9][0-9]{6,14}$","example":"+971501234567"}
def enum(*v): return {"type":"string","enum":list(v)}
def n(s): return {"oneOf":[s,{"type":"null"}]}
# ---------- common
obj("PageInfo",{"nextCursor":n(STR),"hasMore":BOOL,"total":{"type":"integer","description":"Present only when total=true is requested"}},["hasMore"])
obj("Problem",{"type":STR,"title":STR,"status":INT,"code":{"type":"string","description":"Stable machine code, e.g. LEAD_EXISTS"},"detail":STR,"errors":arr({"type":"object","properties":{"field":STR,"message":STR}}),"requestId":STR},["title","status","code"],"Error body (RFC 9457 problem details)")
obj("IdRef",{"id":U,"name":STR},["id"])
# ---------- org
obj("Me",{"user":ref("User"),"tenant":ref("Tenant"),"permissions":arr(STR),"dataScope":enum("own","team","division","company")},["user","tenant","permissions","dataScope"])
obj("Tenant",{"id":Ur,"type":enum("brokerage","individual"),"name":STR,"legalName":STR,"tradeLicenseNo":STR,"reraOrn":STR,"reraBrn":STR,"tradeLicenseFileId":n(U),"verificationStatus":{**enum("pending","verified","rejected"),"readOnly":True},"trn":STR,"email":STR,"phone":STR,"address":STR,"website":STR,"logoFileId":n(U),"timezone":STR,"baseCurrency":CUR},["id","type","name","timezone","baseCurrency","verificationStatus"])
obj("User",{"id":Ur,"email":{"type":"string","format":"email"},"fullName":STR,"phone":n(PHONE),"roleId":U,"teamId":n(U),"status":enum("invited","active","inactive"),"receivesLeads":BOOL,"languages":arr(STR),"location":n(STR),"timezone":STR,"lastLoginAt":{**n(T),"readOnly":True}},["id","email","fullName","roleId","status","receivesLeads"])
obj("UserCreate",{"email":{"type":"string","format":"email"},"fullName":STR,"phone":PHONE,"roleId":U,"teamId":U,"languages":arr(STR),"location":STR},["email","fullName","roleId"])
obj("Colleague",{"id":Ur,"fullName":STR,"teamId":n(U)},["id","fullName","teamId"],"An active user of the same company, as shown in share and assign pickers")
obj("Role",{"id":Ur,"key":{"type":"string","pattern":"^[a-z_]+$"},"name":STR,"dataScope":enum("own","team","division","company"),"isSystem":{"type":"boolean","readOnly":True},"permissions":arr(STR)},["id","key","name","dataScope","permissions"])
obj("Permission",{"key":STR,"module":STR,"description":STR},["key","module","description"])
obj("Team",{"id":Ur,"name":STR,"divisionId":n(U),"salesManagerUserId":n(U),"teamLeaderUserId":n(U),"isActive":BOOL},["id","name"])
obj("Division",{"id":Ur,"name":STR,"gmUserId":n(U),"isActive":BOOL},["id","name"])
obj("Setting",{"key":STR,"value":{"type":"object","additionalProperties":True},"updatedAt":Tr},["key","value"])
obj("LeadStage",{"id":Ur,"key":STR,"name":STR,"category":enum("open","won","lost","invalid"),"sortOrder":INT,"isSystem":{"type":"boolean","readOnly":True},"isActive":BOOL},["id","key","name","category","sortOrder"])
obj("Reason",{"id":Ur,"type":enum("lost","invalid","reassignment"),"key":n(STR),"name":STR,"isActive":BOOL},["id","type","name"])
obj("LeadSource",{"id":Ur,"type":enum("meta","google_ads","linkedin","snapchat","tiktok","website","webhook","property_finder","bayut","dubizzle","whatsapp","import","manual","event","referral","other"),"name":STR,"integrationId":n(U),"qualityScore":{"type":"integer","minimum":0,"maximum":100},"isActive":BOOL},["id","type","name"])
# ---------- leads
LEADW={"fullName":STR,"phonePrimary":PHONE,"phoneAlternate":PHONE,"email":{"type":"string","format":"email"},"countryCode":{"type":"string","pattern":"^[A-Z]{2}$"},"preferredLanguage":STR,"budgetMin":MONEY,"budgetMax":MONEY,"budgetCurrency":CUR,"sourceId":U,"campaignId":U,"eventId":U,"priority":enum("low","medium","high"),"projectIds":arr(U),"primaryProjectId":U}
obj("LeadCreate",{**LEADW,"ownerUserId":{**U,"description":"Optional. If empty, assignment rules choose the owner."},"note":STR},["fullName","sourceId"],"At least one of phonePrimary or email is required.")
obj("LeadUpdate",{k:v for k,v in LEADW.items() if k not in ("sourceId",)}|{"nextFollowUpAt":T,"version":{"type":"integer","description":"Optimistic lock: send the version you read"}},["version"])
obj("Lead",{"id":Ur,**LEADW,"ownerUserId":n(U),"teamId":n(U),"stageId":U,"stageCategory":enum("open","won","lost","invalid"),"closeReasonId":n(U),"score":{"type":"integer","minimum":0,"maximum":100},"latestNote":n(STR),"nextFollowUpAt":n(T),"responseDueAt":n(T),"enquiryCount":INT,"lastEnquiryAt":T,"access":{**enum("owner","edit","view","scope"),"readOnly":True,"description":"How the current user can access this lead"},"deletedAt":n(T),"createdAt":Tr,"updatedAt":Tr,"version":INT},["id","fullName","sourceId","stageId","stageCategory","score","enquiryCount","version","createdAt"])
obj("LeadExists",{"leadId":U,"ownerUserId":n(U),"ownerName":n(STR),"stageName":STR},["leadId"],"Returned with 409 LEAD_EXISTS when the phone or email already belongs to a lead")
obj("StageChange",{"stageId":U,"reasonId":U,"note":STR,"nextFollowUpAt":T},["stageId"],"reasonId is required when the stage category is lost or invalid")
obj("Assign",{"toUserId":U,"reasonId":U,"note":STR},["toUserId"],"reasonId is required when the lead already has an owner")
obj("Share",{"userId":U,"access":enum("view","edit")},["userId","access"])
obj("LeadShare",{"userId":U,"userName":STR,"access":enum("view","edit"),"sharedBy":U,"sharedAt":T},["userId","access","sharedBy","sharedAt"])
obj("Note",{"body":{"type":"string","minLength":1}},["body"])
obj("Activity",{"id":Ur,"type":enum("inquiry","re_enquiry","note","call","stage_change","owner_change","share","whatsapp","email","meeting","viewing","attachment","deal","eoi","booking","invoice","purchase_order","payment","system"),"summary":STR,"body":n(STR),"actorUserId":n(U),"occurredAt":T,"links":{"type":"object","properties":{"inquiryId":U,"taskId":U,"meetingId":U,"messageId":U,"fileId":U,"dealId":U,"financeDocumentId":U,"paymentId":U}}},["id","type","summary","occurredAt"])
obj("Inquiry",{"id":Ur,"sourceId":U,"campaignId":n(U),"isReEnquiry":BOOL,"externalCampaignId":n(STR),"externalAdsetId":n(STR),"externalAdId":n(STR),"externalFormId":n(STR),"externalSubmissionId":n(STR),"formName":n(STR),"formAnswers":{"type":"object","additionalProperties":True},"submittedAt":T,"receivedAt":T},["id","sourceId","isReEnquiry","formAnswers","submittedAt","receivedAt"])
obj("BulkLeadAction",{"leadIds":{**arr(U),"maxItems":500},"action":enum("assign","stage","delete","restore"),"toUserId":U,"stageId":U,"reasonId":U},["leadIds","action"])
obj("BulkResult",{"succeeded":arr(U),"failed":arr({"type":"object","properties":{"id":U,"code":STR,"message":STR}})},["succeeded","failed"])
obj("LeadImport",{"id":Ur,"fileId":U,"mapping":{"type":"object","additionalProperties":{"type":"string"},"description":"CRM field → column header"},"sourceId":U,"status":enum("previewing","importing","completed","failed"),"preview":arr({"type":"object","additionalProperties":True}),"rowsTotal":INT,"rowsImported":INT,"rowsReEnquired":INT,"rowsRejected":INT,"rejectedRowsFileId":n(U)},["id","fileId","status"])
obj("SavedFilter",{"id":Ur,"entity":enum("leads","tasks","units","finance_documents","messages","attendance"),"name":STR,"filters":{"type":"object","additionalProperties":True},"columns":arr(STR),"sort":arr(STR),"sharedTeamId":n(U)},["id","entity","name","filters"])
obj("AssignmentRule",{"id":Ur,"name":STR,"priority":{"type":"integer","minimum":1},"conditions":{"type":"object","properties":{"projectIds":arr(U),"campaignIds":arr(U),"sourceIds":arr(U),"languages":arr(STR),"locations":arr(STR)}},"targetTeamId":n(U),"memberUserIds":arr(U),"respectAvailability":BOOL,"isActive":BOOL},["id","name","priority","conditions"])
obj("Campaign",{"id":Ur,"sourceId":U,"externalId":n(STR),"name":STR,"status":enum("active","paused","ended"),"startsOn":n(D),"endsOn":n(D)},["id","sourceId","name","status"])
obj("AdSpend",{"spendDate":D,"amount":MONEY,"currency":CUR,"entryMethod":enum("api","manual")},["spendDate","amount","currency"])
obj("Event",{"id":Ur,"name":STR,"type":enum("event","roadshow","exhibition","open_house"),"location":STR,"startsAt":T,"endsAt":T,"cost":n(MONEY),"currency":n(CUR)},["id","name","type","startsAt","endsAt"])
# ---------- tasks & meetings
obj("Task",{"id":Ur,"leadId":n(U),"assignedUserId":U,"type":enum("call","follow_up","meeting","viewing","personal"),"title":STR,"description":n(STR),"dueAt":T,"durationMinutes":n(INT),"reminderMinutes":n(INT),"meetingId":n(U),"status":enum("open","completed","cancelled"),"outcome":n(enum("answered","no_answer","busy","wrong_number","call_back")),"outcomeNote":n(STR),"completedAt":{**n(T),"readOnly":True}},["id","assignedUserId","type","title","dueAt","status"])
obj("TaskComplete",{"outcome":enum("answered","no_answer","busy","wrong_number","call_back"),"outcomeNote":STR,"nextAction":{"type":"object","properties":{"type":enum("call","follow_up","meeting","viewing"),"dueAt":T,"title":STR,"reminderMinutes":INT},"required":["type","dueAt"]}},[],"outcome is required for call tasks; nextAction is required for lead tasks unless the lead is closed")
obj("Meeting",{"id":Ur,"leadId":U,"organizerUserId":U,"type":enum("meeting","viewing"),"channel":enum("google_meet","teams","in_person","phone"),"bookedVia":{**enum("agent","booking_page"),"readOnly":True},"joinUrl":{**n(STR),"readOnly":True},"location":n(STR),"projectId":n(U),"unitId":n(U),"dealId":n(U),"startsAt":T,"endsAt":T,"clientTimezone":STR,"status":enum("scheduled","completed","cancelled","no_show"),"cancelReason":n(STR)},["id","leadId","organizerUserId","type","channel","startsAt","endsAt","status"])
obj("MeetingCreate",{"leadId":U,"organizerUserId":U,"type":enum("meeting","viewing"),"channel":enum("google_meet","teams","in_person","phone"),"location":STR,"projectId":U,"unitId":U,"dealId":U,"startsAt":T,"endsAt":T,"clientTimezone":STR,"sendConfirmation":{"type":"boolean","default":True}},["leadId","organizerUserId","type","channel","startsAt","endsAt"],"409 AGENT_BUSY when the agent already has a meeting at that time")
obj("BookingPage",{"id":Ur,"slug":{"type":"string","pattern":"^[a-z0-9-]{3,60}$"},"title":STR,"meetingChannel":enum("google_meet","teams","in_person","phone"),"durationMinutes":INT,"bufferMinutes":INT,"minNoticeHours":INT,"weeklyHours":{"type":"object","additionalProperties":arr(arr(STR)),"example":{"mon":[["09:00","17:00"]]}},"isActive":BOOL,"publicUrl":{"type":"string","readOnly":True}},["slug","title","durationMinutes","weeklyHours","isActive"])
obj("PublicBookingPage",{"title":STR,"agentName":STR,"companyName":STR,"durationMinutes":INT,"meetingChannel":STR,"slots":arr({"type":"object","properties":{"startsAt":T,"endsAt":T}})},["title","agentName","slots"])
obj("PublicBookingRequest",{"startsAt":T,"fullName":STR,"phone":PHONE,"email":{"type":"string","format":"email"},"timezone":{"type":"string","example":"Europe/London"},"message":STR,"consentWhatsApp":BOOL},["startsAt","fullName","phone","timezone"])
obj("PublicBookingConfirmation",{"startsAt":T,"endsAt":T,"joinUrl":n(STR),"timezone":STR},["startsAt","endsAt","timezone"])
# ---------- messaging
obj("Conversation",{"id":Ur,"leadId":U,"channel":enum("whatsapp","email"),"contactAddress":STR,"lastMessageAt":n(T),"lastInboundAt":n(T),"unreadCount":INT,"replyWindowOpen":{"type":"boolean","readOnly":True,"description":"WhatsApp: free-form reply allowed (24 h since last inbound)"}},["id","leadId","channel","contactAddress","unreadCount"])
obj("Message",{"id":Ur,"conversationId":U,"leadId":U,"direction":enum("inbound","outbound"),"templateId":n(U),"campaignId":n(U),"subject":n(STR),"body":n(STR),"mediaFileId":n(U),"status":enum("queued","sent","delivered","read","failed","received"),"errorMessage":n(STR),"sentBy":n(U),"createdAt":Tr},["id","conversationId","leadId","direction","status","createdAt"])
obj("MessageSend",{"channel":enum("whatsapp","email"),"templateId":U,"variables":{"type":"object","additionalProperties":{"type":"string"}},"subject":STR,"body":STR,"mediaFileId":U},["channel"],"WhatsApp outside the 24-hour window requires templateId. 422 OPTED_OUT if the lead opted out of the channel.")
obj("MessageTemplate",{"id":Ur,"channel":enum("whatsapp","email"),"name":STR,"language":STR,"category":enum("marketing","utility","authentication","transactional"),"subject":n(STR),"body":STR,"variables":arr({"type":"object","properties":{"name":STR,"example":STR}}),"status":{**enum("draft","pending","approved","rejected","disabled"),"readOnly":True}},["id","channel","name","language","category","body","status"])
obj("MessageCampaign",{"id":Ur,"name":STR,"channel":enum("whatsapp","email"),"templateId":U,"integrationId":U,"audienceFilter":{"type":"object","additionalProperties":True},"audienceCount":{**n(INT),"readOnly":True},"scheduledAt":n(T),"status":{**enum("draft","pending_approval","approved","rejected","sending","completed","cancelled"),"readOnly":True},"createdBy":{**U,"readOnly":True},"approvedBy":{**n(U),"readOnly":True},"rejectionNote":n(STR)},["id","name","channel","templateId","audienceFilter","status"])
obj("CampaignReport",{"audience":INT,"skippedOptedOut":INT,"sent":INT,"delivered":INT,"failed":INT,"replied":INT,"optedOut":INT},["audience","sent","delivered","failed","replied","optedOut"])
obj("Consent",{"channel":enum("whatsapp","email","sms"),"status":enum("opted_in","opted_out"),"captureMethod":enum("form","import","reply","unsubscribe_link","manual","provider"),"note":n(STR),"recordedAt":Tr},["channel","status","captureMethod"])
# ---------- projects & deals
obj("Developer",{"id":Ur,"name":STR,"trn":n(STR),"contactName":n(STR),"email":n(STR),"phone":n(STR),"address":n(STR),"website":n(STR)},["id","name"])
obj("Project",{"id":Ur,"developerId":U,"name":STR,"community":n(STR),"city":STR,"address":n(STR),"latitude":n({"type":"number"}),"longitude":n({"type":"number"}),"description":n(STR),"constructionStatus":enum("off_plan","under_construction","ready"),"handoverDate":n(D),"paymentPlan":n(STR),"brochureFileId":n(U),"isActive":BOOL,"inventory":{"type":"object","readOnly":True,"properties":{"available":INT,"onHold":INT,"booked":INT,"sold":INT}}},["id","developerId","name","constructionStatus"])
obj("Building",{"id":Ur,"projectId":U,"name":STR,"floors":n(INT),"handoverDate":n(D)},["id","projectId","name"])
obj("Unit",{"id":Ur,"projectId":U,"buildingId":n(U),"unitNumber":STR,"propertyType":enum("apartment","villa","townhouse","penthouse","duplex","office","retail","plot"),"bedrooms":{"type":"integer","minimum":0},"bathrooms":n(INT),"sizeSqft":{"type":"number"},"floor":n(INT),"view":n(STR),"price":MONEY,"currency":CUR,"paymentPlan":n(STR),"handoverDate":n(D),"status":{**enum("available","on_hold","booked","sold"),"readOnly":True},"holdExpiresAt":n(T),"floorPlanFileId":n(U)},["id","projectId","unitNumber","propertyType","bedrooms","sizeSqft","price","currency","status"])
obj("UnitStatusChange",{"status":enum("available","on_hold","booked","sold"),"price":MONEY,"holdExpiresAt":T,"reason":STR},[],"Send status and/or price")
obj("UnitChange",{"oldStatus":n(STR),"newStatus":n(STR),"oldPrice":n(MONEY),"newPrice":n(MONEY),"reason":n(STR),"changedBy":n(U),"changedAt":T},["changedAt"])
obj("Deal",{"id":Ur,"leadId":U,"projectId":U,"unitId":n(U),"ownerUserId":U,"stage":{**enum("offer","eoi","booking","sold","cancelled"),"readOnly":True},"currency":CUR,"offerPrice":n(MONEY),"offerDate":n(D),"eoiAmount":n(MONEY),"eoiDate":n(D),"bookingAmount":n(MONEY),"bookingDate":n(D),"saleValue":n(MONEY),"saleDate":n(D),"cancelledReason":n(STR)},["id","leadId","projectId","ownerUserId","stage","currency"])
obj("DealStageChange",{"stage":enum("eoi","booking","sold","cancelled"),"unitId":U,"amount":MONEY,"date":D,"cancelledReason":STR},["stage"],"409 UNIT_ALREADY_BOOKED when another deal holds the unit")
# ---------- finance
obj("Counterparty",{"id":Ur,"type":enum("client","developer","vendor"),"name":STR,"trn":n(STR),"email":n(STR),"phone":n(STR),"address":n(STR),"leadId":n(U),"developerId":n(U)},["id","type","name"])
obj("DocumentLine",{"lineNo":{"type":"integer","minimum":1},"description":STR,"quantity":{"type":"string","example":"1.000"},"unitPrice":MONEY,"taxRate":{"type":"string","example":"5.00"},"lineSubtotal":{**MONEY,"readOnly":True},"taxAmount":{**MONEY,"readOnly":True}},["lineNo","description","quantity","unitPrice","taxRate"])
obj("FinanceDocument",{"id":Ur,"docType":enum("sales_invoice","purchase_invoice","purchase_order"),"number":{**n(STR),"readOnly":True},"counterpartyId":U,"leadId":n(U),"projectId":n(U),"unitId":n(U),"dealId":n(U),"purchaseOrderId":n(U),"issueDate":D,"dueDate":n(D),"currency":CUR,"rateToBase":{"type":"string"},"lines":arr(ref("DocumentLine")),"subtotal":{**MONEY,"readOnly":True},"taxTotal":{**MONEY,"readOnly":True},"total":{**MONEY,"readOnly":True},"amountPaid":{**MONEY,"readOnly":True},"amountRefunded":{**MONEY,"readOnly":True},"balance":{**MONEY,"readOnly":True},"paymentTerms":n(STR),"notes":n(STR),"status":{**enum("draft","approved","sent","partially_paid","paid","overdue","cancelled","refunded"),"readOnly":True},"pdfFileId":{**n(U),"readOnly":True},"version":INT},["id","docType","counterpartyId","issueDate","currency","lines","status","version"])
obj("Payment",{"id":Ur,"kind":enum("payment","refund"),"amount":MONEY,"currency":CUR,"paidOn":D,"method":enum("bank_transfer","cheque","card","cash","other"),"reference":n(STR),"notes":n(STR),"proofFileId":n(U)},["id","kind","amount","currency","paidOn","method"])
obj("DocumentEvent",{"action":STR,"fromStatus":n(STR),"toStatus":n(STR),"actorUserId":n(U),"note":n(STR),"createdAt":T},["action","createdAt"])
obj("Commission",{"id":Ur,"dealId":U,"userId":U,"basis":enum("percentage","fixed"),"rate":n({"type":"string"}),"amount":MONEY,"currency":CUR,"status":{**enum("pending","approved","paid","cancelled"),"readOnly":True},"developerInvoiceId":n(U),"paidOn":n(D),"notes":n(STR)},["id","dealId","userId","basis","amount","currency","status"])
obj("CancelRequest",{"reason":{"type":"string","minLength":3}},["reason"])
# ---------- attendance
obj("CheckIn",{"photoFileId":U,"latitude":{"type":"number"},"longitude":{"type":"number"},"workFromHome":BOOL},["photoFileId"],"Location is required only when the tenant's policy requires it")
obj("AttendanceRecord",{"id":Ur,"userId":U,"workDate":D,"status":enum("present","late","absent","leave","half_day","wfh"),"checkInAt":n(T),"checkOutAt":n(T),"checkInPhotoFileId":n(U),"checkOutPhotoFileId":n(U),"isCorrected":BOOL},["id","userId","workDate","status","isCorrected"])
obj("AttendanceCorrection",{"id":Ur,"recordId":U,"requestedStatus":enum("present","late","absent","leave","half_day","wfh"),"requestedCheckInAt":n(T),"requestedCheckOutAt":n(T),"reason":STR,"status":{**enum("pending","approved","rejected"),"readOnly":True},"originalValues":{"type":"object","readOnly":True,"additionalProperties":True},"reviewedBy":{**n(U),"readOnly":True},"reviewNote":n(STR)},["id","recordId","requestedStatus","reason","status"])
obj("LeaveRequest",{"id":Ur,"userId":U,"leaveTypeId":U,"startDate":D,"endDate":D,"isHalfDay":BOOL,"reason":n(STR),"status":{**enum("pending","approved","rejected","cancelled"),"readOnly":True},"reviewedBy":{**n(U),"readOnly":True},"reviewNote":n(STR)},["id","userId","leaveTypeId","startDate","endDate","status"])
obj("Review",{"decision":enum("approve","reject"),"note":STR},["decision"])
obj("AttendancePolicy",{"id":Ur,"name":STR,"workStart":{"type":"string","example":"09:00"},"workEnd":{"type":"string","example":"18:00"},"graceMinutes":INT,"halfDayMaxMinutes":INT,"weekendDays":arr({"type":"integer","minimum":0,"maximum":6}),"locationRequired":BOOL,"officeLatitude":n({"type":"number"}),"officeLongitude":n({"type":"number"}),"officeRadiusM":n(INT),"isDefault":BOOL},["id","name","workStart","workEnd","weekendDays"])
obj("Holiday",{"id":Ur,"holidayDate":D,"name":STR},["id","holidayDate","name"])
obj("LeaveType",{"id":Ur,"name":STR,"annualDays":n({"type":"string"}),"isPaid":BOOL,"isActive":BOOL},["id","name"])
# ---------- reports, dashboard
obj("ReportDefinition",{"key":STR,"name":STR,"module":STR,"filters":arr(STR),"columns":arr({"type":"object","properties":{"key":STR,"label":STR,"type":STR}})},["key","name","filters","columns"])
obj("ReportResult",{"columns":arr({"type":"object","properties":{"key":STR,"label":STR}}),"rows":arr({"type":"object","additionalProperties":True}),"totals":{"type":"object","additionalProperties":True},"page":ref("PageInfo")},["columns","rows","totals"])
obj("ExportRequest",{"format":enum("xlsx","csv"),"filters":{"type":"object","additionalProperties":True}},["format"])
obj("Export",{"id":Ur,"reportKey":STR,"format":enum("xlsx","csv"),"status":enum("queued","running","completed","failed"),"rowCount":n(INT),"downloadUrl":{**n(STR),"description":"Time-limited link, present when completed"},"createdAt":Tr},["id","reportKey","format","status","createdAt"])
obj("Dashboard",{"kpis":{"type":"object","properties":{k:INT for k in ["total","new","untouched","overdue","reEnquired","meetingsToday","qualified","eois","bookings"]}|{"salesValue":MONEY,"unpaidInvoices":MONEY}},"bySource":arr(ref("CountBucket")),"byProject":arr(ref("CountBucket")),"byStage":arr(ref("CountBucket")),"funnel":arr(ref("CountBucket")),"byAgent":arr(ref("CountBucket")),"byCampaign":arr(ref("CountBucket")),"trend":arr({"type":"object","properties":{"date":D,"leads":INT,"qualified":INT,"spend":MONEY,"sales":MONEY}}),"refreshedAt":T},["kpis","funnel","refreshedAt"])
obj("CountBucket",{"key":STR,"label":STR,"count":INT,"value":n(MONEY),"drillDown":{"type":"object","description":"Filters that open the underlying records","additionalProperties":True}},["key","label","count"])
# ---------- integrations, files, notifications, audit
obj("Integration",{"id":Ur,"provider":enum("meta","google_ads","linkedin","snapchat","tiktok","website","webhook","property_finder","bayut","dubizzle","whatsapp_cloud","email_ses","gmail","microsoft_365","google_workspace"),"scope":enum("tenant","user"),"userId":n(U),"accountLabel":STR,"status":{**enum("pending","connected","error","disconnected"),"readOnly":True},"lastSuccessAt":{**n(T),"readOnly":True},"lastErrorAt":{**n(T),"readOnly":True},"lastError":{**n(STR),"readOnly":True},"recordsReceived30d":{"type":"integer","readOnly":True},"failures30d":{"type":"integer","readOnly":True},"settings":{"type":"object","additionalProperties":True}},["id","provider","scope","accountLabel","status"])
obj("IntegrationConnect",{"provider":STR,"scope":enum("tenant","user"),"accountLabel":STR,"settings":{"type":"object","additionalProperties":True}},["provider"])
obj("ConnectStart",{"integrationId":U,"authorizeUrl":n({"type":"string","description":"Open this URL to finish OAuth; empty for key-based providers"})},["integrationId"])
obj("WebhookSource",{"integrationId":Ur,"name":STR,"inboundUrl":{"type":"string","readOnly":True,"example":"https://crm.example.ae/webhooks/inbound/whk_3f9c…"},"secret":{"type":"string","readOnly":True,"description":"Shown once; used to sign requests (HMAC-SHA256)"},"sourceId":U,"fieldMapping":{"type":"object","additionalProperties":{"type":"string"},"example":{"fullName":"name","phonePrimary":"mobile","email":"email","project":"interested_in"}}},["name","sourceId","fieldMapping"])
obj("SyncRun",{"id":Ur,"jobType":STR,"status":enum("running","success","partial","failed"),"recordsReceived":INT,"recordsCreated":INT,"recordsFailed":INT,"errorDetail":n(STR),"startedAt":T,"finishedAt":n(T)},["id","jobType","status","startedAt"])
obj("Reconciliation",{"id":Ur,"integrationId":U,"periodStart":T,"periodEnd":T,"sourceCount":INT,"crmCount":INT,"missingExternalIds":arr(STR),"recoveredCount":INT,"status":enum("running","completed","failed")},["id","integrationId","periodStart","periodEnd","status"])
obj("UploadRequest",{"fileName":STR,"mimeType":STR,"sizeBytes":{"type":"integer","maximum":26214400},"purpose":enum("lead_attachment","project_media","unit_floor_plan","finance","attendance_photo","import","message_media","logo")},["fileName","mimeType","sizeBytes","purpose"])
obj("UploadTicket",{"fileId":U,"uploadUrl":{"type":"string","description":"PUT the file bytes here within 10 minutes"},"headers":{"type":"object","additionalProperties":{"type":"string"}}},["fileId","uploadUrl"])
obj("DownloadLink",{"url":STR,"expiresAt":T},["url","expiresAt"])
obj("Attachment",{"id":Ur,"fileId":U,"fileName":STR,"category":enum("document","image","brochure","floor_plan","contract","id_document","receipt","other"),"createdAt":Tr},["id","fileId","category"])
obj("Notification",{"id":Ur,"type":STR,"title":STR,"body":n(STR),"leadId":n(U),"linkPath":n(STR),"readAt":n(T),"createdAt":Tr},["id","type","title","createdAt"])
obj("PushDevice",{"fcmToken":STR,"platform":enum("android","ios","web")},["fcmToken","platform"])
obj("AuditEntry",{"id":{"type":"integer"},"userId":n(U),"action":STR,"entityType":STR,"entityId":n(U),"changes":n({"type":"object","additionalProperties":True}),"ipAddress":n(STR),"createdAt":T},["id","action","entityType","createdAt"])
obj("WebhookAck",{"received":BOOL},["received"])

# ---------- parameters & responses
P={
 "Id":{"name":"id","in":"path","required":True,"schema":U},
 "Cursor":{"name":"cursor","in":"query","schema":STR,"description":"Opaque cursor from page.nextCursor"},
 "Limit":{"name":"limit","in":"query","schema":{"type":"integer","minimum":1,"maximum":200,"default":50}},
 "IdempotencyKey":{"name":"Idempotency-Key","in":"header","schema":{"type":"string","maxLength":100},"description":"Optional. Retrying a POST with the same key returns the first result instead of creating a duplicate."},
 "IfMatch":{"name":"If-Match","in":"header","schema":STR,"description":"Optional ETag (version) for optimistic locking"},
 "From":{"name":"from","in":"query","schema":D},"To":{"name":"to","in":"query","schema":D},
}
def prm(n_): return {"$ref":f"#/components/parameters/{n_}"}
R={}
for code,(name,desc) in {"400":("BadRequest","Invalid request"),"401":("Unauthorized","Missing or expired token"),"403":("Forbidden","No permission or outside data scope"),"404":("NotFound","Not found (or not visible to you)"),"409":("Conflict","Conflicts with current state"),"422":("Unprocessable","Business rule failed"),"429":("TooMany","Rate limit exceeded")}.items():
    R[name]={"description":desc,"content":{"application/problem+json":{"schema":ref("Problem")}}}
def rr(n_): return {"$ref":f"#/components/responses/{n_}"}
STD={"400":rr("BadRequest"),"401":rr("Unauthorized"),"403":rr("Forbidden"),"429":rr("TooMany")}
paths=collections.OrderedDict(); ops=[]
def op(method,path,tag,summary,perm=None,req=None,res=None,code="200",params=(),extra=None,desc=None,auth=True,resdesc=None,errors=()):
    o={"tags":[tag],"summary":summary,"operationId":None}
    words=re.sub(r"[^A-Za-z0-9 ]"," ",summary).split()
    o["operationId"]=words[0].lower()+"".join(w.capitalize() for w in words[1:])
    d=[]
    if desc: d.append(desc)
    if perm: d.append(f"**Permission:** `{perm}`")
    if d: o["description"]="\n\n".join(d)
    if perm: o["x-permission"]=perm
    ps=[p if isinstance(p,dict) else prm(p) for p in params]
    for pn in re.findall(r"\{(\w+)\}",path):
        if pn=="id": ps.insert(0,prm("Id"))
        else: ps.insert(0,{"name":pn,"in":"path","required":True,"schema":(STR if pn in ("key","slug","token","provider") else U)})
    if ps: o["parameters"]=ps
    if req is not None:
        ct="multipart/form-data" if req=="multipart" else "application/json"
        o["requestBody"]={"required":True,"content":{ct:{"schema":req if req!="multipart" else {"type":"object"}}}}
    rs={}
    if res is None and code=="204": rs["204"]={"description":resdesc or "Done"}
    else: rs[code]={"description":resdesc or "OK","content":{"application/json":{"schema":res}}} if res is not None else {"description":resdesc or "OK"}
    if auth: rs.update(STD)
    else: rs.update({"400":rr("BadRequest"),"429":rr("TooMany")})
    if "{" in path: rs["404"]=rr("NotFound")
    for e in errors: rs[e]=rr({"409":"Conflict","422":"Unprocessable","401":"Unauthorized"}[e])
    o["responses"]=dict(sorted(rs.items()))
    if not auth: o["security"]=[]
    if extra: o.update(extra)
    paths.setdefault(path,{})[method]=o; ops.append(o)
def crud(base,tag,schema,perm_view,perm_edit,label,label_pl,filters=(),delete=True,create_schema=None,update=True,get=True):
    op("get",base,tag,f"List {label_pl}",perm_view,res=page(ref(schema)),params=["Cursor","Limit",*filters])
    op("post",base,tag,f"Create {label}",perm_edit,req=ref(create_schema or schema),res=ref(schema),code="201",params=["IdempotencyKey"],errors=("409","422"))
    if get: op("get",base+"/{id}",tag,f"Get {label}",perm_view,res=ref(schema))
    if update: op("patch",base+"/{id}",tag,f"Update {label}",perm_edit,req=ref(schema),res=ref(schema),params=["IfMatch"],errors=("409","422"))
    if delete: op("delete",base+"/{id}",tag,f"Delete {label}",perm_edit,code="204",errors=("409",))
def q(name,schema=STR,desc=None,required=False):
    d={"name":name,"in":"query","schema":schema}
    if desc: d["description"]=desc
    if required: d["required"]=True
    return d
# ===== Session
op("get","/me","Session","Get current user","(any signed-in user)",res=ref("Me"),desc="Who I am, my tenant, my permissions and data scope. The screens use this to show or hide menu items and buttons.")
# ===== Organization
op("get","/organization","Organization","Get organization profile","(any signed-in user)",res=ref("Tenant"))
op("patch","/organization","Organization","Update organization profile","settings.manage",req=ref("Tenant"),res=ref("Tenant"))
crud("/users","Organization","User","users.manage","users.manage","user","users",filters=[q("status",enum("invited","active","inactive")),q("roleId",U),q("teamId",U),q("q",STR,"Search name or email")],delete=False,create_schema="UserCreate")
op("put","/users/{id}/receives-leads","Organization","Turn lead assignment on or off","users.lead_assignment",req={"type":"object","required":["receivesLeads"],"properties":{"receivesLeads":BOOL}},res=ref("User"),desc="Admin switch. When off, the user keeps existing leads but gets no new ones.")
op("post","/users/{id}/deactivate","Organization","Deactivate user","users.manage",req={"type":"object","properties":{"reassignToUserId":U}},res=ref("User"),errors=("422",),desc="422 USER_HAS_OPEN_LEADS unless reassignToUserId is given; leads are then moved and each move is logged.")
op("post","/users/{id}/reactivate","Organization","Reactivate user","users.manage",res=ref("User"))
op("get","/users/directory","Organization","List colleagues","(any signed-in user)",res={"type":"object","required":["data"],"properties":{"data":arr(ref("Colleague"))}},desc="Active users of the company with name and team only, for the share and assign pickers (SRS §2.16, §4). Managing users uses GET /users (users.manage).")
crud("/roles","Organization","Role","users.manage","users.manage","role","roles",desc=None) if False else None
op("get","/roles","Organization","List roles","users.manage",res={"type":"object","properties":{"data":arr(ref("Role"))}})
op("post","/roles","Organization","Create role","users.manage",req=ref("Role"),res=ref("Role"),code="201",errors=("409",),desc="Custom roles such as Sales, Basic or HR.")
op("patch","/roles/{id}","Organization","Update role","users.manage",req=ref("Role"),res=ref("Role"),errors=("422",),desc="Built-in role keys cannot change.")
op("delete","/roles/{id}","Organization","Delete role","users.manage",code="204",errors=("409",),desc="409 ROLE_IN_USE while users have this role; built-in roles cannot be deleted.")
op("get","/permissions","Organization","List permissions","users.manage",res={"type":"object","properties":{"data":arr(ref("Permission"))}})
crud("/teams","Organization","Team","users.manage","users.manage","team","teams")
crud("/divisions","Organization","Division","users.manage","users.manage","division","divisions")
# ===== Settings
op("get","/settings","Settings","List settings","settings.manage",res={"type":"object","properties":{"data":arr(ref("Setting"))}},desc="Keys: leads.response_time, leads.scoring, finance.numbering, …")
op("put","/settings/{key}","Settings","Update setting","settings.manage",req={"type":"object","required":["value"],"properties":{"value":{"type":"object","additionalProperties":True}}},res=ref("Setting"),errors=("422",))
crud("/lead-stages","Settings","LeadStage","leads.view","settings.manage","lead stage","lead stages",delete=True)
crud("/reasons","Settings","Reason","leads.view","settings.manage","reason","reasons",filters=[q("type",enum("lost","invalid","reassignment"))])
crud("/lead-sources","Settings","LeadSource","leads.view","settings.manage","lead source","lead sources")
op("get","/currencies","Settings","List enabled currencies","(any signed-in user)",res={"type":"object","properties":{"data":arr({"type":"object","properties":{"code":CUR,"name":STR,"rateToBase":n(STR)}})}})
op("put","/currencies","Settings","Set enabled currencies and rates","settings.manage",req={"type":"object","properties":{"currencies":arr({"type":"object","required":["code"],"properties":{"code":CUR,"rateToBase":STR,"effectiveDate":D}})}},res={"type":"object","properties":{"data":arr(STR)}})
# ===== Leads
LF=[q("tab",enum("all","my","shared","team","unassigned","deleted","new","pending","scheduled","overdue","cold")),q("q",STR,"Name, phone or email"),q("stageId",U),q("ownerUserId",U),q("teamId",U),q("projectId",U),q("sourceId",U),q("campaignId",U),q("eventId",U),q("budgetMin",MONEY),q("budgetMax",MONEY),q("createdFrom",D),q("createdTo",D),q("savedFilterId",U),q("sort",STR,"Default: -score,nextFollowUpAt"),q("total",BOOL,"Include total count")]
op("get","/leads","Leads","List leads","leads.view",res=page(ref("Lead")),params=["Cursor","Limit",*LF],desc="Only leads in the user's scope, or shared with them, are returned.")
op("post","/leads","Leads","Create lead","leads.create",req=ref("LeadCreate"),res=ref("Lead"),code="201",params=["IdempotencyKey"],errors=("409","422"),desc="409 LEAD_EXISTS (body includes LeadExists) when the phone or email belongs to an existing lead; the screen offers to open it.")
op("get","/leads/check-existing","Leads","Check if a lead exists","leads.create",res={"type":"object","properties":{"exists":BOOL,"lead":n(ref("LeadExists"))},"required":["exists"]},params=[q("phone",PHONE),q("email",STR)],desc="Used while typing a new lead to warn: \"This lead already exists, owned by …\"")
op("get","/leads/{id}","Leads","Get lead","leads.view",res=ref("Lead"))
op("patch","/leads/{id}","Leads","Update lead","leads.edit",req=ref("LeadUpdate"),res=ref("Lead"),errors=("409","422"),desc="409 VERSION_CONFLICT if someone else saved first. Shared users need 'edit' access.")
op("delete","/leads/{id}","Leads","Delete lead","leads.delete",code="204",desc="Soft delete; appears in the Deleted tab.")
op("post","/leads/{id}/restore","Leads","Restore lead","leads.delete",res=ref("Lead"))
op("post","/leads/{id}/stage","Leads","Change lead stage","leads.edit",req=ref("StageChange"),res=ref("Lead"),errors=("422",),desc="422 REASON_REQUIRED for Lost/Invalid. Logged in stage history and the timeline.")
op("post","/leads/{id}/assign","Leads","Assign lead","leads.assign",req=ref("Assign"),res=ref("Lead"),errors=("422",),desc="422 REASON_REQUIRED when reassigning; 422 USER_NOT_RECEIVING_LEADS if assignment is off for the target user. Starts the 10-minute response timer.")
op("get","/leads/{id}/timeline","Leads","Get lead timeline","leads.view",res=page(ref("Activity")),params=["Cursor","Limit",q("types",STR,"Comma-separated activity types")])
op("get","/leads/{id}/inquiries","Leads","List lead enquiries","leads.view",res={"type":"object","properties":{"data":arr(ref("Inquiry"))}},desc="All enquiries including re-enquiries, with original form answers and source IDs.")
op("post","/leads/{id}/notes","Leads","Add note","leads.edit",req=ref("Note"),res=ref("Activity"),code="201",desc="Counts as the owner's response for the 10-minute rule.")
op("get","/leads/{id}/shares","Leads","List lead shares","leads.view",res={"type":"object","properties":{"data":arr(ref("LeadShare"))}})
op("post","/leads/{id}/shares","Leads","Share lead","leads.share",req=ref("Share"),res=ref("LeadShare"),code="201",errors=("422",),desc="Only the owner or a manager above them. Shared user is notified.")
op("delete","/leads/{id}/shares/{userId}","Leads","Remove lead share","leads.share",code="204")
op("put","/leads/{id}/projects","Leads","Set lead projects","leads.edit",req={"type":"object","required":["projectIds"],"properties":{"projectIds":arr(U),"primaryProjectId":U}},res=ref("Lead"))
op("get","/leads/{id}/attachments","Leads","List lead attachments","leads.view",res={"type":"object","properties":{"data":arr(ref("Attachment"))}})
op("post","/leads/{id}/attachments","Leads","Attach file to lead","leads.edit",req={"type":"object","required":["fileId","category"],"properties":{"fileId":U,"category":STR}},res=ref("Attachment"),code="201")
op("post","/leads/bulk","Leads","Bulk update leads","leads.assign",req=ref("BulkLeadAction"),res=ref("BulkResult"),desc="Permission depends on action: assign → leads.assign, stage → leads.edit, delete/restore → leads.delete.")
op("post","/leads/imports","Leads","Start lead import","leads.import",req={"type":"object","required":["fileId","sourceId"],"properties":{"fileId":U,"sourceId":U,"mapping":{"type":"object","additionalProperties":{"type":"string"}}}},res=ref("LeadImport"),code="201",desc="Upload the Excel/CSV via /files/uploads first. Returns a preview; call confirm to import.")
op("get","/leads/imports/{id}","Leads","Get lead import","leads.import",res=ref("LeadImport"))
op("post","/leads/imports/{id}/confirm","Leads","Confirm lead import","leads.import",res=ref("LeadImport"),code="202",resdesc="Import started")
op("get","/saved-filters","Leads","List saved filters","(any signed-in user)",res={"type":"object","properties":{"data":arr(ref("SavedFilter"))}},params=[q("entity",STR)])
op("post","/saved-filters","Leads","Create saved filter","(any signed-in user)",req=ref("SavedFilter"),res=ref("SavedFilter"),code="201")
op("delete","/saved-filters/{id}","Leads","Delete saved filter","(owner)",code="204")
# ===== Assignment & marketing
op("get","/assignment-rules","Assignment","List assignment rules","settings.manage",res={"type":"object","properties":{"data":arr(ref("AssignmentRule"))}})
op("post","/assignment-rules","Assignment","Create assignment rule","settings.manage",req=ref("AssignmentRule"),res=ref("AssignmentRule"),code="201")
op("patch","/assignment-rules/{id}","Assignment","Update assignment rule","settings.manage",req=ref("AssignmentRule"),res=ref("AssignmentRule"))
op("delete","/assignment-rules/{id}","Assignment","Delete assignment rule","settings.manage",code="204")
op("put","/assignment-rules/order","Assignment","Reorder assignment rules","settings.manage",req={"type":"object","required":["ruleIds"],"properties":{"ruleIds":arr(U)}},code="204")
crud("/campaigns","Marketing","Campaign","leads.view","settings.manage","campaign","campaigns",filters=[q("sourceId",U),q("status",STR)],delete=False)
op("get","/campaigns/{id}/spend","Marketing","List campaign spend","leads.view",res={"type":"object","properties":{"data":arr(ref("AdSpend"))}},params=["From","To"])
op("put","/campaigns/{id}/spend","Marketing","Enter campaign spend","settings.manage",req={"type":"object","properties":{"days":arr(ref("AdSpend"))}},code="204",desc="Manual entry; API-imported days are overwritten only by the import.")
crud("/events","Marketing","Event","leads.view","leads.create","event","events",params=None) if False else crud("/events","Marketing","Event","leads.view","leads.create","event","events")
# ===== Tasks & meetings
op("get","/tasks","Tasks","List tasks","(own tasks; managers within scope)",res=page(ref("Task")),params=["Cursor","Limit",q("assignedUserId",U),q("leadId",U),q("status",STR),q("type",STR),"From","To",q("view",enum("day","week","month","list")),q("overdue",BOOL)])
op("post","/tasks","Tasks","Create task","leads.edit",req=ref("Task"),res=ref("Task"),code="201",params=["IdempotencyKey"])
op("patch","/tasks/{id}","Tasks","Update task","leads.edit",req=ref("Task"),res=ref("Task"))
op("post","/tasks/{id}/complete","Tasks","Complete task","leads.edit",req=ref("TaskComplete"),res={"type":"object","properties":{"task":ref("Task"),"nextTask":n(ref("Task"))}},errors=("422",),desc="422 OUTCOME_REQUIRED / NEXT_ACTION_REQUIRED. Updates the lead's next follow-up and timeline; counts as a response for the 10-minute rule.")
op("post","/tasks/{id}/cancel","Tasks","Cancel task","leads.edit",res=ref("Task"))
op("get","/meetings","Meetings","List meetings","leads.view",res=page(ref("Meeting")),params=["Cursor","Limit",q("organizerUserId",U),q("leadId",U),"From","To",q("status",STR)])
op("post","/meetings","Meetings","Create meeting","leads.edit",req=ref("MeetingCreate"),res=ref("Meeting"),code="201",params=["IdempotencyKey"],errors=("409","422"),desc="Creates the Google Meet / Teams link, the calendar event and the client confirmation. 409 AGENT_BUSY on overlap.")
op("get","/meetings/{id}","Meetings","Get meeting","leads.view",res=ref("Meeting"))
op("patch","/meetings/{id}","Meetings","Reschedule meeting","leads.edit",req={"type":"object","properties":{"startsAt":T,"endsAt":T,"location":STR}},res=ref("Meeting"),errors=("409",))
op("post","/meetings/{id}/cancel","Meetings","Cancel meeting","leads.edit",req=ref("CancelRequest"),res=ref("Meeting"))
op("post","/meetings/{id}/complete","Meetings","Complete meeting","leads.edit",req={"type":"object","required":["status"],"properties":{"status":enum("completed","no_show"),"note":STR,"nextAction":S["TaskComplete"]["properties"]["nextAction"]}},res=ref("Meeting"))
op("get","/availability","Meetings","Get agent free slots","leads.view",res={"type":"object","properties":{"slots":arr({"type":"object","properties":{"startsAt":T,"endsAt":T}})}},params=[q("userId",U,required=True),"From","To",q("durationMinutes",INT)])
op("get","/booking-pages/me","Meetings","Get my booking page","(any signed-in user)",res=ref("BookingPage"))
op("put","/booking-pages/me","Meetings","Save my booking page","(any signed-in user)",req=ref("BookingPage"),res=ref("BookingPage"),errors=("409",),desc="409 SLUG_TAKEN if the link name is used.")
op("get","/public/booking/{slug}","Public booking","Get public booking page",None,res=ref("PublicBookingPage"),params=["From","To",q("timezone",STR)],auth=False,desc="No login. Shows the agent's free slots in the client's time zone.")
op("post","/public/booking/{slug}","Public booking","Book a slot",None,req=ref("PublicBookingRequest"),res=ref("PublicBookingConfirmation"),code="201",auth=False,errors=("409",),desc="No login; protected by rate limiting and a bot check (Cloudflare Turnstile token in header CF-Turnstile-Token). Matches the client to an existing lead by phone/email (re-enquiry) or creates one owned by the page's agent. 409 SLOT_TAKEN.")
# ===== Messaging
op("get","/conversations","Messaging","List conversations","messages.send",res=page(ref("Conversation")),params=["Cursor","Limit",q("channel",STR),q("unread",BOOL),q("leadId",U)])
op("get","/conversations/{id}/messages","Messaging","List messages","messages.send",res=page(ref("Message")),params=["Cursor","Limit"])
op("post","/conversations/{id}/read","Messaging","Mark conversation read","messages.send",code="204")
op("post","/leads/{id}/messages","Messaging","Send message to lead","messages.send",req=ref("MessageSend"),res=ref("Message"),code="202",params=["IdempotencyKey"],errors=("422",),resdesc="Queued for sending",desc="422 OPTED_OUT, TEMPLATE_REQUIRED (WhatsApp outside the 24-hour window).")
op("get","/leads/{id}/consents","Messaging","Get lead consent history","leads.view",res={"type":"object","properties":{"data":arr(ref("Consent"))}})
op("post","/leads/{id}/consents","Messaging","Record consent","leads.edit",req=ref("Consent"),res=ref("Consent"),code="201")
crud("/message-templates","Messaging","MessageTemplate","messages.send or settings.manage","settings.manage","message template","message templates",filters=[q("channel",STR),q("status",STR)])
op("post","/message-templates/{id}/submit","Messaging","Submit template to WhatsApp","settings.manage",res=ref("MessageTemplate"),desc="Sends a WhatsApp template to Meta for approval; status updates by webhook.")
op("get","/message-campaigns","Messaging","List bulk campaigns","campaigns.create",res=page(ref("MessageCampaign")),params=["Cursor","Limit",q("status",STR)])
op("post","/message-campaigns","Messaging","Create bulk campaign","campaigns.create",req=ref("MessageCampaign"),res=ref("MessageCampaign"),code="201")
op("get","/message-campaigns/{id}","Messaging","Get bulk campaign","campaigns.create",res=ref("MessageCampaign"))
op("patch","/message-campaigns/{id}","Messaging","Update bulk campaign","campaigns.create",req=ref("MessageCampaign"),res=ref("MessageCampaign"),errors=("409",),desc="Only while draft or rejected.")
op("post","/message-campaigns/{id}/preview-audience","Messaging","Preview campaign audience","campaigns.create",res={"type":"object","properties":{"count":INT,"excludedOptedOut":INT,"sample":arr(ref("IdRef"))}})
op("post","/message-campaigns/{id}/test","Messaging","Send campaign test","campaigns.create",req={"type":"object","required":["to"],"properties":{"to":STR}},code="202")
op("post","/message-campaigns/{id}/submit","Messaging","Submit campaign for approval","campaigns.create",res=ref("MessageCampaign"),errors=("422",),desc="422 TEST_REQUIRED if no test was sent.")
op("post","/message-campaigns/{id}/approve","Messaging","Approve campaign","campaigns.approve",res=ref("MessageCampaign"),errors=("422",),desc="422 SELF_APPROVAL: the creator cannot approve their own campaign.")
op("post","/message-campaigns/{id}/reject","Messaging","Reject campaign","campaigns.approve",req={"type":"object","required":["note"],"properties":{"note":STR}},res=ref("MessageCampaign"))
op("post","/message-campaigns/{id}/cancel","Messaging","Cancel campaign","campaigns.create",res=ref("MessageCampaign"))
op("get","/message-campaigns/{id}/report","Messaging","Get campaign report","campaigns.create",res=ref("CampaignReport"))
# ===== Projects & deals
crud("/developers","Projects","Developer","leads.view","projects.manage","developer","developers")
crud("/projects","Projects","Project","leads.view","projects.manage","project","projects",filters=[q("developerId",U),q("q",STR),q("isActive",BOOL)])
op("get","/projects/{id}/buildings","Projects","List buildings","leads.view",res={"type":"object","properties":{"data":arr(ref("Building"))}})
op("post","/projects/{id}/buildings","Projects","Create building","projects.manage",req=ref("Building"),res=ref("Building"),code="201")
op("patch","/buildings/{id}","Projects","Update building","projects.manage",req=ref("Building"),res=ref("Building"))
op("get","/units","Projects","List units","leads.view",res=page(ref("Unit")),params=["Cursor","Limit",q("projectId",U),q("buildingId",U),q("propertyType",STR),q("bedrooms",INT),q("priceMin",MONEY),q("priceMax",MONEY),q("status",STR)])
op("post","/units","Projects","Create unit","projects.manage",req=ref("Unit"),res=ref("Unit"),code="201",errors=("409",))
op("get","/units/{id}","Projects","Get unit","leads.view",res=ref("Unit"))
op("patch","/units/{id}","Projects","Update unit details","projects.manage",req=ref("Unit"),res=ref("Unit"),desc="Price and status are changed through /units/{id}/status so the history is kept.")
op("post","/units/{id}/status","Projects","Change unit status or price","units.change_status",req=ref("UnitStatusChange"),res=ref("Unit"),errors=("409","422"))
op("get","/units/{id}/history","Projects","Get unit price and status history","leads.view",res={"type":"object","properties":{"data":arr(ref("UnitChange"))}})
op("post","/projects/{id}/attachments","Projects","Attach file to project","projects.manage",req={"type":"object","required":["fileId","category"],"properties":{"fileId":U,"category":STR,"sortOrder":INT}},res=ref("Attachment"),code="201")
op("get","/deals","Deals","List deals","leads.view",res=page(ref("Deal")),params=["Cursor","Limit",q("leadId",U),q("projectId",U),q("stage",STR),q("ownerUserId",U)])
op("post","/deals","Deals","Create deal","leads.edit",req=ref("Deal"),res=ref("Deal"),code="201",errors=("422",))
op("get","/deals/{id}","Deals","Get deal","leads.view",res=ref("Deal"))
op("patch","/deals/{id}","Deals","Update deal","leads.edit",req=ref("Deal"),res=ref("Deal"))
op("post","/deals/{id}/stage","Deals","Change deal stage","leads.edit",req=ref("DealStageChange"),res=ref("Deal"),errors=("409","422"),desc="Moves the unit to On Hold / Booked / Sold and updates the lead timeline.")
# ===== Finance
crud("/counterparties","Finance","Counterparty","finance.create","finance.create","counterparty","counterparties",filters=[q("type",STR),q("q",STR)],delete=False)
op("get","/finance-documents","Finance","List financial documents","finance.create",res=page(ref("FinanceDocument")),params=["Cursor","Limit",q("docType",STR),q("status",STR),q("counterpartyId",U),q("leadId",U),q("dealId",U),"From","To"])
op("post","/finance-documents","Finance","Create financial document","finance.create",req=ref("FinanceDocument"),res=ref("FinanceDocument"),code="201",params=["IdempotencyKey"],desc="Created as draft; totals are calculated by the server.")
op("get","/finance-documents/{id}","Finance","Get financial document","finance.create",res=ref("FinanceDocument"))
op("patch","/finance-documents/{id}","Finance","Update draft document","finance.create",req=ref("FinanceDocument"),res=ref("FinanceDocument"),params=["IfMatch"],errors=("409","422"),desc="422 NOT_DRAFT: approved documents cannot be edited; cancel and reissue.")
op("post","/finance-documents/{id}/approve","Finance","Approve document","finance.approve",res=ref("FinanceDocument"),errors=("422",),desc="Assigns the number (e.g. INV-2026-0042), generates the PDF and locks amounts.")
op("post","/finance-documents/{id}/send","Finance","Send document","finance.approve",req={"type":"object","properties":{"to":arr(STR),"message":STR}},res=ref("FinanceDocument"))
op("post","/finance-documents/{id}/cancel","Finance","Cancel document","finance.approve",req=ref("CancelRequest"),res=ref("FinanceDocument"))
op("get","/finance-documents/{id}/pdf","Finance","Download document PDF","finance.create",res=ref("DownloadLink"))
op("get","/finance-documents/{id}/history","Finance","Get document history","finance.create",res={"type":"object","properties":{"data":arr(ref("DocumentEvent"))}})
op("get","/finance-documents/{id}/payments","Finance","List payments","finance.create",res={"type":"object","properties":{"data":arr(ref("Payment"))}})
op("post","/finance-documents/{id}/payments","Finance","Record payment or refund","finance.approve",req=ref("Payment"),res=ref("FinanceDocument"),code="201",params=["IdempotencyKey"],errors=("422",),desc="422 AMOUNT_EXCEEDS_BALANCE / CURRENCY_MISMATCH. Status becomes Partially Paid, Paid or Refunded automatically.")
op("get","/commissions","Finance","List commissions","finance.create",res=page(ref("Commission")),params=["Cursor","Limit",q("userId",U),q("dealId",U),q("status",STR)])
op("post","/commissions","Finance","Create commission","finance.create",req=ref("Commission"),res=ref("Commission"),code="201",errors=("409",))
op("post","/commissions/{id}/approve","Finance","Approve commission","finance.approve",res=ref("Commission"))
op("post","/commissions/{id}/mark-paid","Finance","Mark commission paid","finance.approve",req={"type":"object","required":["paidOn"],"properties":{"paidOn":D}},res=ref("Commission"))
# ===== Attendance
op("post","/attendance/check-in","Attendance","Check in","(own)",req=ref("CheckIn"),res=ref("AttendanceRecord"),code="201",errors=("409","422"),desc="409 ALREADY_CHECKED_IN; 422 LOCATION_REQUIRED / OUTSIDE_OFFICE_RADIUS. Status (present / late) is set by policy.")
op("post","/attendance/check-out","Attendance","Check out","(own)",req=ref("CheckIn"),res=ref("AttendanceRecord"),errors=("409",))
op("get","/attendance/records","Attendance","List attendance records","attendance.view",res=page(ref("AttendanceRecord")),params=["Cursor","Limit",q("userId",U),q("teamId",U),"From","To",q("status",STR)])
op("post","/attendance/records/{id}/corrections","Attendance","Request attendance correction","(own)",req=ref("AttendanceCorrection"),res=ref("AttendanceCorrection"),code="201")
op("get","/attendance/corrections","Attendance","List correction requests","attendance.approve",res=page(ref("AttendanceCorrection")),params=["Cursor","Limit",q("status",STR)])
op("post","/attendance/corrections/{id}/review","Attendance","Review correction","attendance.approve",req=ref("Review"),res=ref("AttendanceCorrection"),errors=("422",),desc="422 SELF_REVIEW. On approval the record is updated and the original values are kept.")
op("get","/leave-requests","Attendance","List leave requests","attendance.view",res=page(ref("LeaveRequest")),params=["Cursor","Limit",q("userId",U),q("status",STR),"From","To"])
op("post","/leave-requests","Attendance","Request leave","(own)",req=ref("LeaveRequest"),res=ref("LeaveRequest"),code="201",errors=("409",),desc="409 LEAVE_OVERLAP.")
op("post","/leave-requests/{id}/review","Attendance","Review leave request","attendance.approve",req=ref("Review"),res=ref("LeaveRequest"),errors=("409","422"))
op("post","/leave-requests/{id}/cancel","Attendance","Cancel leave request","(own)",res=ref("LeaveRequest"))
crud("/attendance-policies","Attendance","AttendancePolicy","attendance.view","settings.manage","attendance policy","attendance policies")
crud("/holidays","Attendance","Holiday","attendance.view","settings.manage","holiday","holidays",update=False,get=False)
crud("/leave-types","Attendance","LeaveType","attendance.view","settings.manage","leave type","leave types",get=False)
# ===== Reports & dashboard
RF=["From","To",q("projectId",U),q("sourceId",U),q("campaignId",U),q("teamId",U),q("userId",U)]
op("get","/dashboard","Dashboard","Get dashboard","leads.view",res=ref("Dashboard"),params=RF,desc="Data is limited to the user's scope. Figures are at most 5 minutes old.")
op("get","/reports","Reports","List reports","leads.view",res={"type":"object","properties":{"data":arr(ref("ReportDefinition"))}},desc="Only reports the user may view (finance and attendance reports need their module permissions).")
op("get","/reports/{key}","Reports","Run report","leads.view",res=ref("ReportResult"),params=["Cursor","Limit",*RF])
op("post","/reports/{key}/exports","Reports","Export report","reports.export",req=ref("ExportRequest"),res=ref("Export"),code="202",errors=("403",) if False else (),desc="Admin only by default (leads.export / reports.export / attendance.export by report). Totals equal the on-screen totals. Every export is logged. Large exports run in the background; the user is notified.")
op("get","/exports/{id}","Reports","Get export","reports.export",res=ref("Export"))
op("post","/integrations/{id}/reconciliations","Reports","Run Meta reconciliation","settings.manage",req={"type":"object","required":["periodStart","periodEnd"],"properties":{"periodStart":T,"periodEnd":T,"recoverMissing":{"type":"boolean","default":True}}},res=ref("Reconciliation"),code="202")
op("get","/reconciliations","Reports","List reconciliation runs","settings.manage",res=page(ref("Reconciliation")),params=["Cursor","Limit",q("integrationId",U)])
# ===== Integrations
op("get","/integrations","Integrations","List integrations","settings.manage",res={"type":"object","properties":{"data":arr(ref("Integration"))}},desc="Includes the user's own calendar/mail connections for non-admins.")
op("post","/integrations","Integrations","Connect integration","settings.manage",req=ref("IntegrationConnect"),res=ref("ConnectStart"),code="201",desc="OAuth providers return authorizeUrl; user-scope providers (Google, Microsoft, Gmail) only need the user to be signed in.")
op("get","/integrations/{id}","Integrations","Get integration","settings.manage",res=ref("Integration"))
op("patch","/integrations/{id}","Integrations","Update integration settings","settings.manage",req=ref("Integration"),res=ref("Integration"))
op("post","/integrations/{id}/test","Integrations","Test integration","settings.manage",res={"type":"object","properties":{"ok":BOOL,"detail":STR}})
op("post","/integrations/{id}/retry","Integrations","Retry failed events","settings.manage",res={"type":"object","properties":{"requeued":INT}},code="202")
op("delete","/integrations/{id}","Integrations","Disconnect integration","settings.manage",code="204")
op("get","/integrations/{id}/sync-runs","Integrations","List sync runs","settings.manage",res=page(ref("SyncRun")),params=["Cursor","Limit"])
op("get","/oauth/{provider}/callback","Integrations","OAuth callback",None,code="302",resdesc="Redirects back to the Integrations screen",params=[q("code",STR),q("state",STR,required=True)],auth=False,desc="Provider redirects here after the user approves access; state is a signed, single-use value.")
op("post","/webhook-sources","Integrations","Create general webhook","settings.manage",req=ref("WebhookSource"),res=ref("WebhookSource"),code="201",desc="Creates a secure inbound URL for any system: website, Google Sheets (Apps Script), Excel (Power Automate), Make.com. The secret is shown once.")
op("put","/webhook-sources/{id}/mapping","Integrations","Update webhook field mapping","settings.manage",req={"type":"object","required":["fieldMapping"],"properties":{"fieldMapping":{"type":"object","additionalProperties":{"type":"string"}}}},res=ref("WebhookSource"))
op("post","/webhook-sources/{id}/rotate-secret","Integrations","Rotate webhook secret","settings.manage",res=ref("WebhookSource"))
# ===== Files, notifications, audit
op("post","/files/uploads","Files","Request upload","(any signed-in user)",req=ref("UploadRequest"),res=ref("UploadTicket"),code="201",errors=("422",),desc="Returns a 10-minute S3 upload link. 422 FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE (25 MB).")
op("post","/files/{id}/complete","Files","Confirm upload","(uploader)",res={"type":"object","properties":{"fileId":U,"sizeBytes":INT}})
op("get","/files/{id}/download","Files","Get download link","(record access)",res=ref("DownloadLink"),desc="5-minute link; only for files the user may see.")
op("get","/notifications","Notifications","List notifications","(own)",res=page(ref("Notification")),params=["Cursor","Limit",q("unread",BOOL)])
op("post","/notifications/{id}/read","Notifications","Mark notification read","(own)",code="204")
op("post","/notifications/read-all","Notifications","Mark all notifications read","(own)",code="204")
op("post","/push-devices","Notifications","Register push device","(own)",req=ref("PushDevice"),code="204")
op("delete","/push-devices/{token}","Notifications","Remove push device","(own)",code="204")
op("get","/audit-logs","Audit","List audit log","audit.view",res=page(ref("AuditEntry")),params=["Cursor","Limit",q("entityType",STR),q("entityId",U),q("userId",U),q("action",STR),"From","To"])
# ===== Inbound webhooks
WH=dict(auth=False,res=ref("WebhookAck"),errors=("401",))
op("get","/webhooks/meta","Webhooks (inbound)","Verify Meta webhook",None,auth=False,code="200",res={"type":"string"},params=[q("hub.mode",STR),q("hub.verify_token",STR),q("hub.challenge",STR)],resdesc="Echoes hub.challenge")
op("post","/webhooks/meta","Webhooks (inbound)","Receive Meta lead",None,req={"type":"object","additionalProperties":True},desc="Signature: X-Hub-Signature-256. Stored, acknowledged in under 1 s, processed by the worker.",**WH)
op("get","/webhooks/whatsapp","Webhooks (inbound)","Verify WhatsApp webhook",None,auth=False,code="200",res={"type":"string"},params=[q("hub.mode",STR),q("hub.verify_token",STR),q("hub.challenge",STR)],resdesc="Echoes hub.challenge")
op("post","/webhooks/whatsapp","Webhooks (inbound)","Receive WhatsApp message or status",None,req={"type":"object","additionalProperties":True},desc="Inbound messages, delivery statuses and template approvals. Signature: X-Hub-Signature-256.",**WH)
op("post","/webhooks/portals/{provider}","Webhooks (inbound)","Receive portal lead",None,req={"type":"object","additionalProperties":True},desc="provider: property_finder, bayut, dubizzle. Verified with the shared secret set up for the account.",**WH)
op("post","/webhooks/inbound/{token}","Webhooks (inbound)","Receive general webhook lead",None,req={"type":"object","additionalProperties":True},desc="Any system (website, Google Sheets, Excel/Power Automate, Make.com). Header X-Signature: HMAC-SHA256 of the body with the source secret. Fields are mapped by the source's field mapping.",**WH)
op("post","/webhooks/email-inbound","Webhooks (inbound)","Receive portal lead email",None,req={"type":"object","additionalProperties":True},desc="AWS SES → SNS notification for lead emails from portals; SNS signature verified.",**WH)
op("post","/webhooks/calendar/{provider}","Webhooks (inbound)","Receive calendar change",None,req={"type":"object","additionalProperties":True},desc="provider: google, microsoft. Channel token verified.",**WH)


# ===== additions (end-to-end coverage check vs SRS v1.1)
obj("SearchResult",{"leads":arr(ref("IdRef")),"projects":arr(ref("IdRef")),"units":arr(ref("IdRef")),"users":arr(ref("IdRef"))},["leads"])
op("get","/search","Session","Global search","(any signed-in user)",res=ref("SearchResult"),params=[q("q",STR,"Name, phone or email (min 2 characters)",required=True),q("limit",INT)],desc="Search box on every screen. Results are limited to the user's scope.")
obj("CallLog",{"outcome":enum("answered","no_answer","busy","wrong_number","call_back"),"note":STR,"durationSeconds":INT,"nextAction":S["TaskComplete"]["properties"]["nextAction"]},["outcome"],"Log a call that was not planned as a task")
op("post","/leads/{id}/calls","Leads","Log call","leads.edit",req=ref("CallLog"),res=ref("Activity"),code="201",errors=("422",),desc="Adds the call to the timeline and sets the next follow-up. Counts as the owner's response for the 10-minute rule. wrong_number prompts moving the lead to Invalid.")
op("post","/leads/{id}/priority","Leads","Set lead priority","leads.edit",req={"type":"object","required":["priority"],"properties":{"priority":enum("low","medium","high")}},res=ref("Lead"))
for base,tag,perm in [("/units/{id}/attachments","Projects","projects.manage"),("/deals/{id}/attachments","Deals","leads.edit"),("/finance-documents/{id}/attachments","Finance","finance.create"),("/commissions/{id}/attachments","Finance","finance.create")]:
    label=base.split("/")[1].replace("-"," ").rstrip("s")
    op("get",base,tag,f"List {label} attachments",perm,res={"type":"object","properties":{"data":arr(ref("Attachment"))}})
    op("post",base,tag,f"Attach file to {label}",perm,req={"type":"object","required":["fileId","category"],"properties":{"fileId":U,"category":STR}},res=ref("Attachment"),code="201")
op("delete","/attachments/{id}","Files","Remove attachment","(edit access to the record)",code="204")
op("get","/exports","Reports","List export log","audit.view",res=page(ref("Export")),params=["Cursor","Limit",q("userId",U),"From","To"],desc="Every export with user, report, filters, format, rows and time.")
obj("WebhookEvent",{"id":Ur,"provider":STR,"externalEventId":STR,"status":enum("received","processed","failed","ignored"),"attempts":INT,"lastError":n(STR),"receivedAt":T,"processedAt":n(T)},["id","provider","status","attempts","receivedAt"])
op("get","/integrations/{id}/events","Integrations","List incoming events","settings.manage",res=page(ref("WebhookEvent")),params=["Cursor","Limit",q("status",STR)],desc="Failures with error detail, for the Integrations screen.")
op("post","/webhook-events/{id}/retry","Integrations","Retry one incoming event","settings.manage",res=ref("WebhookEvent"),code="202")
op("get","/users/{id}/workload","Organization","Get user workload","users.manage",res={"type":"object","properties":{"openLeads":INT,"overdue":INT,"missedLast30d":INT,"avgResponseMinutes":n({"type":"number"})}},desc="Used before deactivating a user or switching off lead assignment.")

# ===== v1.2: Subscriptions & billing, sign-up, owner console
obj("Plan",{"id":Ur,"key":STR,"name":STR,"description":n(STR),"tenantType":n(enum("brokerage","individual")),"priceMonthly":MONEY,"priceYearly":MONEY,"currency":CUR,"minSeats":INT,"maxSeats":n(INT),"selfService":BOOL,"isActive":BOOL},["id","key","name","priceMonthly","priceYearly","currency","minSeats","selfService"],"Prices are per user, excluding 5% VAT")
SUBST=enum("trialing","active","past_due","read_only","canceled")
obj("Subscription",{"id":Ur,"plan":ref("Plan"),"status":{**SUBST,"readOnly":True},"billingCycle":enum("monthly","yearly"),"seats":{"type":"integer","minimum":1},"seatsUsed":{"type":"integer","readOnly":True,"description":"Active users now"},"pricePerSeat":MONEY,"currency":CUR,"paymentMethod":enum("card","bank_transfer"),"cardLast4":n({"type":"string","readOnly":True}),"trialEndsAt":{**n(T),"readOnly":True},"currentPeriodEnd":{**n(T),"readOnly":True},"graceEndsAt":{**n(T),"readOnly":True},"cancelAtPeriodEnd":BOOL,"dataDeleteAfter":{**n(D),"readOnly":True},"nextInvoiceEstimate":{"type":"object","readOnly":True,"properties":{"subtotal":MONEY,"vat":MONEY,"total":MONEY,"date":D}}},["id","plan","status","billingCycle","seats","seatsUsed","pricePerSeat","currency","paymentMethod","cancelAtPeriodEnd"])
obj("BillingInvoice",{"id":Ur,"number":STR,"status":enum("open","paid","void","uncollectible"),"periodStart":D,"periodEnd":D,"issueDate":D,"dueDate":D,"currency":CUR,"lines":arr({"type":"object","properties":{"type":enum("subscription","extra_seats","credit"),"description":STR,"quantity":INT,"unitPrice":MONEY,"amount":MONEY}}),"subtotal":MONEY,"vatRate":{"type":"string","example":"5.00"},"vatAmount":MONEY,"total":MONEY,"amountPaid":MONEY,"balance":MONEY,"paidAt":n(T)},["id","number","status","periodStart","periodEnd","issueDate","dueDate","currency","subtotal","vatAmount","total","balance"])
obj("BillingPayment",{"id":Ur,"invoiceId":U,"invoiceNumber":STR,"tenantId":U,"tenantName":STR,"method":enum("card","bank_transfer"),"status":enum("pending","succeeded","failed","refunded"),"amount":MONEY,"currency":CUR,"bankReference":n(STR),"proofFileId":n(U),"failureReason":n(STR),"receivedAt":n(T),"createdAt":Tr},["id","invoiceId","method","status","amount","currency","createdAt"])
obj("SubscriptionEvent",{"id":Ur,"type":STR,"oldValue":n({"type":"object","additionalProperties":True}),"newValue":n({"type":"object","additionalProperties":True}),"actorType":enum("user","platform_admin","system","stripe"),"actorName":n(STR),"note":n(STR),"createdAt":T},["id","type","actorType","createdAt"])
obj("CardSetup",{"stripePublishableKey":STR,"setupIntentClientSecret":STR},["stripePublishableKey","setupIntentClientSecret"],"Used by Stripe Elements in the browser; card details never reach our servers")
obj("SignupStart",{"tenantType":enum("brokerage","individual"),"companyName":STR,"tradeLicenseNo":STR,"reraOrn":STR,"reraBrn":STR,"adminFullName":STR,"adminEmail":{"type":"string","format":"email"},"adminPhone":PHONE,"planKey":STR,"seats":{"type":"integer","minimum":1},"billingCycle":enum("monthly","yearly"),"acceptTerms":{"type":"boolean","const":True},"turnstileToken":STR},["tenantType","companyName","adminFullName","adminEmail","adminPhone","planKey","billingCycle","acceptTerms","turnstileToken"],"Brokerage: tradeLicenseNo and reraOrn required. Individual agent: reraBrn required.")
obj("Signup",{"signupId":U,"emailVerified":BOOL,"cardSetup":ref("CardSetup"),"expiresAt":T},["signupId","emailVerified","cardSetup","expiresAt"])
obj("SignupComplete",{"tenantId":U,"trialEndsAt":T,"loginUrl":STR},["tenantId","trialEndsAt","loginUrl"])
obj("SalesEnquiry",{"id":Ur,"companyName":STR,"contactName":STR,"email":{"type":"string","format":"email"},"phone":PHONE,"usersEstimate":INT,"message":STR,"status":{**enum("new","contacted","won","lost"),"readOnly":True},"createdAt":Tr},["companyName","contactName","email"])
obj("BillingUsage",{"seats":INT,"seatsUsed":INT,"invitedUsers":INT,"leadsThisMonth":INT,"messagesThisMonth":INT,"storageBytes":INT},["seats","seatsUsed"])
obj("PlatformTenant",{"id":Ur,"name":STR,"type":enum("brokerage","individual"),"legalName":n(STR),"tradeLicenseNo":n(STR),"reraOrn":n(STR),"reraBrn":n(STR),"tradeLicenseFileId":n(U),"verificationStatus":enum("pending","verified","rejected"),"status":enum("active","suspended","closed"),"subscription":ref("Subscription"),"usage":ref("BillingUsage"),"adminEmail":STR,"createdAt":Tr,"lastActiveAt":n(T)},["id","name","type","verificationStatus","status","subscription"])
obj("PlatformMetrics",{"mrr":MONEY,"arr":MONEY,"payingTenants":INT,"trialingTenants":INT,"pastDueTenants":INT,"readOnlyTenants":INT,"paidSeats":INT,"newTrials30d":INT,"trialConversion30d":{"type":"number"},"churned30d":INT,"pendingBankTransfers":INT,"pendingVerifications":INT},["mrr","payingTenants","trialingTenants","paidSeats"])
obj("PlatformAdmin",{"id":Ur,"email":STR,"fullName":STR,"role":enum("owner","support","billing")},["id","email","fullName","role"])
# --- public sign-up
PUB="Public sign-up"
op("get","/public/plans",PUB,"List plans for pricing page",None,res={"type":"object","properties":{"data":arr(ref("Plan"))}},auth=False,desc="Active plans with prices per user (excluding VAT). No login.")
op("post","/public/signup",PUB,"Start sign-up",None,req=ref("SignupStart"),res=ref("Signup"),code="201",auth=False,errors=("409","422"),desc="Step 1. Checks the bot token, plan and RERA / licence fields, and emails a 6-digit code. Returns a Stripe card setup, because a card is required to start the 14-day trial. 409 EMAIL_ALREADY_REGISTERED; 422 LICENCE_REQUIRED, PLAN_NOT_SELF_SERVICE (Enterprise goes through sales).")
op("post","/public/signup/{id}/verify-email",PUB,"Verify sign-up email",None,req={"type":"object","required":["code"],"properties":{"code":{"type":"string","pattern":"^[0-9]{6}$"}}},res=ref("Signup"),auth=False,errors=("422",),desc="Step 2. 422 CODE_INVALID or CODE_EXPIRED (5 tries, 15 minutes).")
op("post","/public/signup/{id}/resend-code",PUB,"Resend sign-up code",None,code="204",auth=False,desc="At most once a minute.")
op("post","/public/signup/{id}/complete",PUB,"Complete sign-up and start trial",None,req={"type":"object","required":["setupIntentId"],"properties":{"setupIntentId":STR}},res=ref("SignupComplete"),code="201",auth=False,errors=("422",),desc="Step 3, after the card is saved with Stripe. Creates the company with default roles, stages and settings, the Admin user and a 14-day trial subscription; licence verification by our team starts in the background. 422 CARD_REQUIRED, EMAIL_NOT_VERIFIED.")
op("post","/public/sales-enquiries",PUB,"Contact sales",None,req=ref("SalesEnquiry"),res={"type":"object","properties":{"received":BOOL}},code="201",auth=False,desc="Enterprise and 'talk to sales' form. Protected by the bot check.")
# --- tenant billing
BL="Subscription & billing"
op("get","/billing/subscription",BL,"Get subscription","billing.view",res=ref("Subscription"),desc="Plan, seats used / paid, status, trial or renewal date and the next invoice estimate.")
op("post","/billing/subscription/change-plan",BL,"Change plan or billing cycle","billing.manage",req={"type":"object","required":["planId"],"properties":{"planId":U,"billingCycle":enum("monthly","yearly")}},res=ref("Subscription"),errors=("422",),desc="Upgrades and a switch to yearly apply now with a pro-rata charge; downgrades apply at the next renewal. 422 PLAN_NOT_ALLOWED (e.g. Solo for a brokerage).")
op("put","/billing/subscription/seats",BL,"Change number of seats","billing.manage",req={"type":"object","required":["seats"],"properties":{"seats":{"type":"integer","minimum":1}}},res=ref("Subscription"),errors=("422",),desc="More seats: charged pro-rata now. Fewer seats: from the next renewal. 422 SEATS_BELOW_ACTIVE_USERS (deactivate users first).")
op("put","/billing/subscription/payment-method",BL,"Change payment method","billing.manage",req={"type":"object","required":["method"],"properties":{"method":enum("card","bank_transfer")}},res=ref("Subscription"),desc="Bank transfer: invoices are emailed with our bank details and paid by transfer.")
op("post","/billing/card-setup",BL,"Start card update","billing.manage",res=ref("CardSetup"),code="201",desc="Returns a Stripe card setup for adding or replacing the card.")
op("post","/billing/subscription/cancel",BL,"Cancel subscription","billing.manage",req={"type":"object","properties":{"reason":STR}},res=ref("Subscription"),desc="Cancels at the end of the paid period; no refund for the started period. Data stays available for export for 90 days after the end, then is deleted.")
op("post","/billing/subscription/resume",BL,"Undo cancellation","billing.manage",res=ref("Subscription"),errors=("422",),desc="Only before the period ends.")
op("get","/billing/invoices",BL,"List subscription invoices","billing.view",res=page(ref("BillingInvoice")),params=["Cursor","Limit",q("status",enum("open","paid","void","uncollectible"))])
op("get","/billing/invoices/{id}",BL,"Get subscription invoice","billing.view",res=ref("BillingInvoice"))
op("get","/billing/invoices/{id}/pdf",BL,"Download invoice PDF","billing.view",res=ref("DownloadLink"),desc="UAE tax invoice with our TRN and 5% VAT.")
op("post","/billing/invoices/{id}/bank-transfers",BL,"Submit bank transfer details","billing.manage",req={"type":"object","required":["amount","bankReference"],"properties":{"amount":MONEY,"bankReference":STR,"proofFileId":U}},res=ref("BillingPayment"),code="201",desc="Records the transfer as pending; our team confirms it when the money arrives.")
op("get","/billing/payments",BL,"List subscription payments","billing.view",res=page(ref("BillingPayment")),params=["Cursor","Limit"])
op("get","/billing/usage",BL,"Get usage","billing.view",res=ref("BillingUsage"))
op("get","/billing/history",BL,"List subscription history","billing.view",res=page(ref("SubscriptionEvent")),params=["Cursor","Limit"])
op("post","/billing/data-export",BL,"Export all company data","billing.manage",res=ref("Export"),code="202",desc="Full export (Excel/CSV zip) of all company data; also available while read-only and for 90 days after cancellation.")
# --- owner console
OC="Owner console"
PO="(platform: owner)"; PS="(platform: owner, support)"; PB="(platform: owner, billing)"; PA="(platform: any)"
op("get","/platform/me",OC,"Get platform admin",PA,res=ref("PlatformAdmin"),desc="Owner console uses its own login (separate Cognito user pool, two-factor required) and its own database role.")
op("get","/platform/metrics",OC,"Get business metrics",PS,res=ref("PlatformMetrics"),desc="Monthly recurring revenue, paying and trial companies, paid seats, conversion and churn.")
op("get","/platform/tenants",OC,"List companies",PS,res=page(ref("PlatformTenant")),params=["Cursor","Limit",q("q",STR,"Name, email, licence"),q("subscriptionStatus",SUBST),q("verificationStatus",enum("pending","verified","rejected")),q("planKey",STR)])
op("get","/platform/tenants/{id}",OC,"Get company",PS,res=ref("PlatformTenant"),desc="Profile, subscription, usage and verification. Does not show the company's leads or messages.")
op("post","/platform/tenants/{id}/verify",OC,"Verify company licence",PS,req={"type":"object","required":["result"],"properties":{"result":enum("verified","rejected"),"note":STR}},res=ref("PlatformTenant"),desc="Checks trade licence / RERA ORN or broker card BRN. WhatsApp can be connected only after verification.")
op("post","/platform/tenants/{id}/suspend",OC,"Suspend company",PO,req={"type":"object","required":["reason"],"properties":{"reason":STR}},res=ref("PlatformTenant"),desc="Blocks login for all users of the company (e.g. abuse). Data is kept.")
op("post","/platform/tenants/{id}/unsuspend",OC,"Unsuspend company",PO,res=ref("PlatformTenant"))
op("post","/platform/tenants/{id}/extend",OC,"Extend trial or grace period",PO,req={"type":"object","required":["days","note"],"properties":{"days":{"type":"integer","minimum":1,"maximum":90},"note":STR}},res=ref("PlatformTenant"),desc="Free extra days, e.g. for a pilot brokerage. Logged in the subscription history.")
op("patch","/platform/subscriptions/{id}",OC,"Set custom price or seats",PO,req={"type":"object","properties":{"pricePerSeat":MONEY,"seats":INT,"planId":U,"note":STR}},res=ref("Subscription"),desc="Enterprise deals: custom price per user.")
op("post","/platform/sales-enquiries/{id}/create-company",OC,"Create Enterprise company",PO,req={"type":"object","required":["tenantType","companyName","adminEmail","adminFullName","seats","pricePerSeat","billingCycle","paymentMethod"],"properties":{"tenantType":enum("brokerage","individual"),"companyName":STR,"tradeLicenseNo":STR,"reraOrn":STR,"adminEmail":STR,"adminFullName":STR,"seats":INT,"pricePerSeat":MONEY,"billingCycle":enum("monthly","yearly"),"paymentMethod":enum("card","bank_transfer"),"trialDays":INT}},res=ref("PlatformTenant"),code="201",desc="Sets up a company sold through sales and emails the Admin an invitation.")
op("get","/platform/sales-enquiries",OC,"List sales enquiries",PS,res=page(ref("SalesEnquiry")),params=["Cursor","Limit",q("status",enum("new","contacted","won","lost"))])
op("patch","/platform/sales-enquiries/{id}",OC,"Update sales enquiry",PS,req={"type":"object","properties":{"status":enum("new","contacted","won","lost"),"note":STR}},res=ref("SalesEnquiry"))
op("get","/platform/billing-invoices",OC,"List all subscription invoices",PB,res=page(ref("BillingInvoice")),params=["Cursor","Limit",q("tenantId",U),q("status",enum("open","paid","void","uncollectible")),"From","To"])
op("post","/platform/billing-invoices/{id}/void",OC,"Void subscription invoice",PB,req={"type":"object","required":["reason"],"properties":{"reason":STR}},res=ref("BillingInvoice"),errors=("409",),desc="Only unpaid invoices. A corrected invoice is issued instead of editing.")
op("get","/platform/bank-transfers",OC,"List pending bank transfers",PB,res=page(ref("BillingPayment")),params=["Cursor","Limit"])
op("post","/platform/billing-payments/{id}/confirm",OC,"Confirm bank transfer",PB,req={"type":"object","required":["receivedAt"],"properties":{"receivedAt":T,"amount":MONEY}},res=ref("BillingPayment"),desc="Marks the invoice paid; a read-only or past-due company is reactivated at once.")
op("post","/platform/billing-payments/{id}/reject",OC,"Reject bank transfer",PB,req={"type":"object","required":["reason"],"properties":{"reason":STR}},res=ref("BillingPayment"))
op("get","/platform/plans",OC,"List all plans",PA,res={"type":"object","properties":{"data":arr(ref("Plan"))}})
op("post","/platform/plans",OC,"Create plan",PO,req=ref("Plan"),res=ref("Plan"),code="201",errors=("409",))
op("patch","/platform/plans/{id}",OC,"Update plan",PO,req=ref("Plan"),res=ref("Plan"),desc="Price changes apply to new subscriptions; existing customers keep their agreed price until changed.")
op("get","/platform/settings",OC,"List platform settings",PA,res={"type":"object","properties":{"data":arr(ref("Setting"))}},desc="billing.trial (14 days, card required), billing.grace (14 days), billing.retention (90 days), billing.vat (5%), billing.payment_methods.")
op("put","/platform/settings/{key}",OC,"Update platform setting",PO,req={"type":"object","required":["value"],"properties":{"value":{"type":"object","additionalProperties":True}}},res=ref("Setting"))
op("get","/platform/audit-logs",OC,"List owner console audit log",PO,res=page(ref("AuditEntry")),params=["Cursor","Limit",q("tenantId",U),"From","To"])
op("post","/webhooks/stripe","Webhooks (inbound)","Receive Stripe billing event",None,req={"type":"object","additionalProperties":True},desc="Card saved, invoice paid, payment failed, subscription updated. Signature: Stripe-Signature. Stored first, then processed by the worker: payment failed → past_due with a 14-day grace; still unpaid → read_only; paid → active.",**WH)
# seat-limit notes on existing user operations
for pth,m in [("/users","post"),("/users/{id}/reactivate","post")]:
    o=paths[pth][m]; o["description"]=(o.get("description","")+"\n\n422 SEAT_LIMIT_REACHED when all paid seats are used (invited users do not use a seat until they accept).").strip()
    o["responses"]["422"]=rr("Unprocessable"); o["responses"]=dict(sorted(o["responses"].items()))
R["PaymentRequired"]={"description":"Company is read-only (unpaid after the grace period) or suspended","content":{"application/problem+json":{"schema":ref("Problem")}}}

spec={"openapi":"3.1.0","info":{"title":"Dubai Real Estate CRM API","version":"1.2.0","description":"REST API for the Dubai Real Estate CRM (matches SRS v1.2).\n\n- Base URL: `https://crm.example.ae/api/v1` (staging: `https://staging.crm.example.ae/api/v1`)\n- Auth: `Authorization: Bearer <Cognito access token>`; two-factor login is required.\n- Every request is limited to the user's tenant and data scope.\n- JSON fields use camelCase; times are ISO 8601 UTC; money is a decimal string.\n- Subscription: when a company is read-only (unpaid after the 14-day grace) every change returns 402 SUBSCRIPTION_READ_ONLY; reading and exporting still work. A suspended company gets 403 TENANT_SUSPENDED.\n- Owner console (`/platform/...`) uses a separate login for the platform team.\n- In the running app, Swagger UI is served at `/api/docs` from this contract."},
"servers":[{"url":"https://crm.example.ae/api/v1","description":"Production"},{"url":"https://staging.crm.example.ae/api/v1","description":"Staging"},{"url":"http://localhost:4000/api/v1","description":"Local"}],
"security":[{"bearer":[]}],
"tags":[{"name":t} for t in ["Session","Organization","Settings","Leads","Assignment","Marketing","Tasks","Meetings","Public booking","Messaging","Projects","Deals","Finance","Attendance","Dashboard","Reports","Integrations","Files","Notifications","Audit","Public sign-up","Subscription & billing","Owner console","Webhooks (inbound)"]],
"paths":paths,"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer","bearerFormat":"JWT"}},"parameters":P,"responses":R,"schemas":S}}
# ---------- validation
errs=[]
txt=json.dumps(spec)
for r_ in set(re.findall(r'"\$ref": "#/components/(\w+)/([\w\-]+)"',txt)):
    if r_[1] not in spec["components"][r_[0]]: errs.append("missing ref "+str(r_))
ids=[o["operationId"] for o in ops]
dup=[i for i,c in collections.Counter(ids).items() if c>1]
if dup: errs.append("dup operationIds "+str(dup))
tagnames={t["name"] for t in spec["tags"]}
for path,ms in paths.items():
    tmpl=set(re.findall(r"\{(\w+)\}",path))
    for m,o in ms.items():
        declared=set()
        for p in o.get("parameters",[]):
            if "$ref" in p: p=P[p["$ref"].split("/")[-1]]
            if p["in"]=="path": declared.add(p["name"]); assert p.get("required")
        if declared!=tmpl: errs.append(f"path params {m} {path}: {declared} vs {tmpl}")
        if o["tags"][0] not in tagnames: errs.append("tag "+o["tags"][0])
        if not o["responses"]: errs.append("no responses "+path)
        if m=="get" and "requestBody" in o: errs.append("GET with body "+path)
# perm keys exist in seed
seed=open("/home/claude/crm-docs/db/seed.sql").read()
keys=set(re.findall(r"\('([a-z_]+\.[a-z_]+)','",seed))
for o in ops:
    p_=o.get("x-permission")
    if p_ and not p_.startswith("(") and p_ not in keys: errs.append("unknown permission "+p_)
print("errors:",errs if errs else "none")
print("paths",len(paths),"operations",len(ops),"schemas",len(S))
class D2(yaml.SafeDumper):
    def ignore_aliases(self, data): return True
D2.add_representer(collections.OrderedDict, lambda d,v: d.represent_dict(v.items()))
yaml.dump(spec,open("/home/claude/repo/api/openapi.yaml","w"),Dumper=D2,sort_keys=False,allow_unicode=True,width=120)
json.dump(spec,open("/home/claude/repo/api/openapi.json","w"),indent=1)

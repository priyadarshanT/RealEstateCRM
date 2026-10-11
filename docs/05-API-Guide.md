# 05 · API documentation

**Dubai Real Estate CRM** · Version 1.2 · 11 October 2026 · Matches SRS v1.2 and database v1.2

The full contract is in [`api/openapi.yaml`](../api/openapi.yaml) (OpenAPI 3.1): **287 endpoints, 109 data models**. In the running app the same contract is shown as interactive **Swagger UI at `/api/docs`**. This guide explains the rules every endpoint follows.

---

## 1. In simple words

The **screens** (web and phone) never touch the database. They ask the **API** for data and send it changes, like a waiter taking orders to the kitchen. **Outside systems** (Meta, WhatsApp, Property Finder, Bayut, Dubizzle, the general webhook) send new leads and message updates to special **webhook** addresses. Every request is checked: who are you, which company are you in, and are you allowed to do this?

```
Screens (Next.js) ──HTTPS──▶  /api/v1/*        ──▶ NestJS API ──▶ PostgreSQL
Clients, new
customers          ──HTTPS──▶  /api/v1/public/* (booking page, pricing, sign-up; no login)
Platform team      ──HTTPS──▶  /api/v1/platform/* (owner console, separate login)
Meta, WhatsApp, portals,
webhook senders,
Stripe             ──HTTPS──▶  /webhooks/*      ──▶ saved, then processed by the worker
```

## 2. Basics

| Item | Rule |
|---|---|
| Base URL | `https://crm.example.ae/api/v1` · staging `https://staging.crm.example.ae/api/v1` · local `http://localhost:4000/api/v1` |
| Format | JSON, UTF-8. Field names in `camelCase`. |
| Times | ISO 8601 in UTC, e.g. `2026-10-11T08:30:00Z`. Screens convert to the user's (or client's) time zone. |
| Money | Decimal **string** with 2 places, e.g. `"3250000.00"`, plus a `currency` (ISO code). Never floating point. |
| IDs | UUID strings. |
| Versioning | `/api/v1`. Adding fields is not a breaking change; removing or renaming is, and needs `/api/v2`. |

## 3. Login and access

1. The screen sends the user to the **Cognito** login page (OIDC + PKCE). Two-factor login is required.
2. Cognito returns an **access token** (valid 1 hour) and a refresh token.
3. Every API call sends `Authorization: Bearer <access token>`.
4. For every request the API runs, in order: **token check → tenant → permission → data scope → input validation**.
5. `GET /me` returns the user, tenant, permissions and data scope; the screens use it to show or hide menus and buttons. The server still checks every action itself.

| Data scope | Sees |
|---|---|
| own | Own records, plus leads shared with the user |
| team | Records of the teams the user leads or manages |
| division | Records of the user's divisions |
| company | Everything in the tenant |

A record outside the user's scope returns **404** (not 403), so its existence is not revealed.

## 4. Lists, filters and sorting

- Lists use **cursor paging**: `?limit=50&cursor=…`. The response is `{ "data": [...], "page": { "nextCursor": "…", "hasMore": true } }`. Add `total=true` only when a count is needed.
- Filters are query parameters, e.g. `GET /leads?tab=overdue&projectId=…&createdFrom=2026-10-01`.
- Sorting: `sort=-score,nextFollowUpAt` (minus = descending). Leads default to best score first.
- Saved filters (`/saved-filters`) store the same parameters by name.

## 5. Creating and changing data safely

| Header | Use |
|---|---|
| `Idempotency-Key` | On important POSTs (create lead, send message, record payment). Retrying with the same key returns the first result, so a double-click or network retry never creates duplicates. |
| `If-Match` / `version` | Optimistic locking on leads and financial documents. If someone else saved first, the API returns **409 VERSION_CONFLICT** and the screen asks the user to reload. |

Business actions have their own endpoints so the rules and history are always applied, for example `POST /leads/{id}/stage`, `POST /leads/{id}/assign`, `POST /units/{id}/status`, `POST /finance-documents/{id}/approve`.

## 6. Errors

All errors use **problem details** (`application/problem+json`):

```json
{
  "type": "https://crm.example.ae/errors/lead-exists",
  "title": "Lead already exists",
  "status": 409,
  "code": "LEAD_EXISTS",
  "detail": "This lead already exists, owned by Sara Ali.",
  "requestId": "req_7f3a…"
}
```

| HTTP | Meaning |
|---|---|
| 400 | Invalid input (`errors[]` lists each field) |
| 401 | Not logged in or token expired |
| 403 | Logged in but not allowed (permission) |
| 404 | Not found, or outside your scope |
| 402 | Company is read-only: subscription unpaid after the 14-day grace (`SUBSCRIPTION_READ_ONLY`). Reading and exporting still work. |
| 409 | Conflicts with the current state |
| 422 | A business rule failed |
| 429 | Too many requests (see `Retry-After`) |

**Business error codes** (the `code` field; screens show a friendly message for each):

| Code | When |
|---|---|
| LEAD_EXISTS | New lead's phone/email belongs to an existing lead (re-enquiry rule) |
| REASON_REQUIRED | Lost/Invalid stage or reassignment without a reason |
| USER_NOT_RECEIVING_LEADS | Assigning to a user whose lead assignment is switched off |
| USER_HAS_OPEN_LEADS | Deactivating a user who still owns open leads |
| VERSION_CONFLICT | Someone else saved the record first |
| OUTCOME_REQUIRED / NEXT_ACTION_REQUIRED | Completing a call without an outcome or next action |
| AGENT_BUSY / SLOT_TAKEN | Meeting overlaps the agent's calendar |
| SLUG_TAKEN | Booking-page link name already used |
| OPTED_OUT | Message to a lead who opted out of that channel |
| TEMPLATE_REQUIRED | WhatsApp outside the 24-hour reply window needs an approved template |
| TEST_REQUIRED / SELF_APPROVAL | Campaign submitted without a test / creator approving their own campaign |
| UNIT_ALREADY_BOOKED | Unit is held by another deal |
| NOT_DRAFT | Editing an approved financial document |
| AMOUNT_EXCEEDS_BALANCE / CURRENCY_MISMATCH | Invalid payment |
| ALREADY_CHECKED_IN / LOCATION_REQUIRED / OUTSIDE_OFFICE_RADIUS | Attendance check-in rules |
| LEAVE_OVERLAP / SELF_REVIEW | Leave overlaps approved leave / approving your own request |
| ROLE_IN_USE | Deleting a role that users still have |
| FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE | Upload rules (max 25 MB) |
| SUBSCRIPTION_READ_ONLY | Any change while the company is unpaid after the grace period (HTTP 402) |
| TENANT_SUSPENDED | Company suspended by the platform team (HTTP 403) |
| SEAT_LIMIT_REACHED | Adding or reactivating a user when all paid seats are used |
| SEATS_BELOW_ACTIVE_USERS | Reducing seats below the number of active users |
| PLAN_NOT_ALLOWED / PLAN_NOT_SELF_SERVICE | Plan does not fit the company type / Enterprise must go through sales |
| LICENCE_REQUIRED | Sign-up without trade licence + RERA ORN (brokerage) or RERA BRN (agent) |
| EMAIL_ALREADY_REGISTERED / CODE_INVALID / CODE_EXPIRED / EMAIL_NOT_VERIFIED / CARD_REQUIRED | Sign-up steps |

## 7. Files

1. `POST /files/uploads` → returns a 10-minute upload link.
2. The screen uploads the file straight to S3 with `PUT`.
3. `POST /files/{id}/complete`, then link the file, e.g. `POST /leads/{id}/attachments`.
4. Downloads: `GET /files/{id}/download` returns a 5-minute link, only for files the user may see.

## 8. Inbound webhooks (how outside systems talk to us)

| Source | Address | Security |
|---|---|---|
| Meta lead ads | `POST /webhooks/meta` (+ `GET` verification) | `X-Hub-Signature-256` |
| WhatsApp | `POST /webhooks/whatsapp` (+ `GET` verification) | `X-Hub-Signature-256` |
| Property Finder, Bayut, Dubizzle | `POST /webhooks/portals/{provider}` | Shared secret per account |
| **General webhook** (website, Google Sheets, Excel via Power Automate, Make.com, any tool) | `POST /webhooks/inbound/{token}` | `X-Signature`: HMAC-SHA256 of the body with the source secret |
| Portal lead emails | `POST /webhooks/email-inbound` (via AWS SES/SNS) | SNS signature |
| Google / Microsoft calendars | `POST /webhooks/calendar/{provider}` | Channel token |

Every webhook is **saved first and answered within 1 second**, then processed in the background. The same event ID is never processed twice. Failures are retried 5 times, then shown on the Integrations screen with Retry.

**General webhook example** (e.g. from a website form or a Google Sheet row):

```http
POST /webhooks/inbound/whk_3f9c2e…
Content-Type: application/json
X-Signature: sha256=5d41402abc4b2a76b9719d911017c592…

{ "name": "Priya Sharma", "mobile": "+971559871122", "email": "priya@mail.com",
  "interested_in": "Sobha Hartland", "submission_id": "row-1842" }
```

The source's **field mapping** (set by Admin) turns `name`, `mobile`, … into CRM fields. `submission_id` prevents double imports. A known phone or email becomes a **re-enquiry** on the existing lead.

## 9. Public booking page (no login)

- `GET /public/booking/{slug}`: the agent's free slots in the client's time zone.
- `POST /public/booking/{slug}`: books the slot, creates the Google Meet / Teams link and confirmation, and links the client to an existing lead (re-enquiry) or a new lead owned by that agent.
- Protected by rate limits and a bot check (Cloudflare Turnstile).

## 10. Limits

| Who | Limit |
|---|---|
| Signed-in user | 600 requests per minute |
| Public booking page | 30 requests per minute per IP |
| Public sign-up and contact sales | 10 requests per minute per IP, plus bot check |
| Webhooks | 1,200 requests per minute per source |
| Bulk lead actions | 500 leads per request |
| Uploads | 25 MB per file |

## 10a. Subscriptions, billing and owner console

| Item | Rule |
|---|---|
| Plans | Solo (1 agent), Team (brokerage), Enterprise (through sales). AED 99 per user per month, excluding 5% VAT; monthly or yearly. |
| Sign-up | `POST /public/signup` → `verify-email` → card saved with Stripe → `complete`. A card is required; the 14-day trial starts at once. |
| Licence | Brokerage: trade licence + RERA ORN. Individual agent: RERA BRN. Checked by the platform team; WhatsApp is connected only after verification. |
| Seats | Active users can never exceed paid seats (enforced by the database). Invited users don't use a seat until they accept. |
| Payment | Card through Stripe (automatic) or bank transfer (customer submits reference; platform team confirms). |
| Payment failed | Status `past_due`; 14 days' grace with reminders; then `read_only` (402 on every change). Paying reactivates at once. Data is never deleted while unpaid. |
| Cancel | At the end of the paid period, no refund for the started period. Data can be exported for 90 days, then deleted. |
| Owner console | `/platform/*`: separate Cognito user pool with two-factor login, own database role (`crm_platform`). Roles: owner, support, billing. Every action is in the platform audit log. Cannot read a company's leads or messages. |
| Stripe | `POST /webhooks/stripe` (signature checked, stored first, processed by the worker). Card details never reach our servers. |

## 11a. Every SRS feature and the APIs that deliver it

| SRS feature (v1.2) | API calls (in order) |
|---|---|
| **Login and permissions** | Cognito login → `GET /me` |
| **Global search** | `GET /search?q=` |
| **Lead tabs, filters, saved filters, columns** | `GET /leads?tab=…&…` · `GET/POST/DELETE /saved-filters` |
| **New lead by hand** (with "already exists" warning) | `GET /leads/check-existing` → `POST /leads` (409 LEAD_EXISTS → open existing) |
| **Leads from Meta / portals / webhook / WhatsApp** | `POST /webhooks/meta` · `/webhooks/portals/{provider}` · `/webhooks/inbound/{token}` · `/webhooks/whatsapp` · `/webhooks/email-inbound` (worker creates lead or re-enquiry) |
| **Excel / CSV import** | `POST /files/uploads` → PUT file → `POST /leads/imports` (preview) → `POST /leads/imports/{id}/confirm` → `GET /leads/imports/{id}` |
| **Re-enquiry to previous agent** | Automatic in intake; visible in `GET /leads/{id}/inquiries` and `GET /leads/{id}/timeline`; agent gets a notification |
| **Automatic assignment** | Automatic on create; rules via `GET/POST/PATCH/DELETE /assignment-rules`, `PUT /assignment-rules/order` |
| **10-minute rule → next agent → Admin** | Automatic (worker); any of `POST /leads/{id}/notes`, `/calls`, `/stage`, `/messages`, `POST /tasks/{id}/complete` stops the timer; moves show in timeline |
| **Manual assign / reassign (reason)** | `POST /leads/{id}/assign` · bulk `POST /leads/bulk` |
| **Admin: switch lead assignment on/off** | `PUT /users/{id}/receives-leads` · `GET /users/{id}/workload` |
| **Lead page and timeline** | `GET /leads/{id}` · `GET /leads/{id}/timeline` · `GET /leads/{id}/inquiries` |
| **Note, call, stage, priority, attach** | `POST /leads/{id}/notes` · `/calls` · `/stage` · `/priority` · `/attachments` |
| **Share lead (view / edit)** | `GET/POST /leads/{id}/shares` · `DELETE /leads/{id}/shares/{userId}` · Shared tab `GET /leads?tab=shared` |
| **Projects of interest** | `PUT /leads/{id}/projects` |
| **Delete / restore** | `DELETE /leads/{id}` · `POST /leads/{id}/restore` |
| **Tasks, calendar views, reminders, overdue** | `GET/POST/PATCH /tasks` · `POST /tasks/{id}/complete` · `/cancel` (reminders and overdue alerts by worker → `GET /notifications`) |
| **Meetings and viewings (Meet / Teams), no double booking** | `GET /availability` → `POST /meetings` (409 AGENT_BUSY) · `PATCH /meetings/{id}` · `/cancel` · `/complete` |
| **Client booking page** | `GET/PUT /booking-pages/me` · public `GET/POST /public/booking/{slug}` |
| **Calendar sync** | `POST /integrations` (google_workspace / microsoft_365, user scope) · `POST /webhooks/calendar/{provider}` |
| **Team: users, hierarchy, roles and permissions** | `/users` · `/users/{id}/deactivate` · `/teams` · `/divisions` · `/roles` · `GET /permissions` |
| **WhatsApp and email one-to-one** | `GET /conversations` · `GET /conversations/{id}/messages` · `POST /leads/{id}/messages` · `POST /conversations/{id}/read` |
| **Templates** | `/message-templates` · `POST /message-templates/{id}/submit` |
| **Bulk campaigns with approval** | `POST /message-campaigns` → `/preview-audience` → `/test` → `/submit` → `/approve` or `/reject` → `GET /message-campaigns/{id}/report` |
| **Consent and opt-out** | `GET/POST /leads/{id}/consents` (opt-out replies recorded automatically by webhook) |
| **Developers, projects, buildings, units** | `/developers` · `/projects` · `/projects/{id}/buildings` · `/units` · `/units/{id}/attachments` |
| **Unit status / price with history** | `POST /units/{id}/status` · `GET /units/{id}/history` |
| **Deal: offer → EOI → booking → sold** | `POST /deals` · `POST /deals/{id}/stage` (409 UNIT_ALREADY_BOOKED) · `/deals/{id}/attachments` |
| **Invoices and purchase orders** | `/counterparties` · `POST /finance-documents` → `PATCH` (draft) → `/approve` → `/send` · `/cancel` · `/pdf` · `/history` · `/attachments` |
| **Payments and refunds** | `GET/POST /finance-documents/{id}/payments` |
| **Commissions** | `/commissions` · `/approve` · `/mark-paid` · `/commissions/{id}/attachments` |
| **Attendance check-in / out with photo** | `POST /files/uploads` (photo) → `POST /attendance/check-in` · `/check-out` · `GET /attendance/records` |
| **Corrections (original kept)** | `POST /attendance/records/{id}/corrections` · `GET /attendance/corrections` · `POST /attendance/corrections/{id}/review` |
| **Leave** | `/leave-requests` · `/review` · `/cancel` · `/leave-types` · `/holidays` · `/attendance-policies` |
| **Dashboard with drill-down** | `GET /dashboard?…` → each bucket's `drillDown` filters → `GET /leads?…` |
| **Reports and exports (Admin only)** | `GET /reports` · `GET /reports/{key}` · `POST /reports/{key}/exports` · `GET /exports/{id}` · export log `GET /exports` |
| **Ad spend, events** | `/campaigns` · `GET/PUT /campaigns/{id}/spend` · `/events` |
| **Meta reconciliation** | `POST /integrations/{id}/reconciliations` · `GET /reconciliations` |
| **Integrations screen** | `GET/POST /integrations` · `/test` · `/retry` · `DELETE` · `/sync-runs` · `/events` · `POST /webhook-events/{id}/retry` |
| **General webhook setup** | `POST /webhook-sources` · `PUT /webhook-sources/{id}/mapping` · `/rotate-secret` |
| **Settings** | `/settings` · `/lead-stages` · `/reasons` · `/lead-sources` · `/currencies` · `GET/PATCH /organization` |
| **Notifications and push** | `GET /notifications` · `/read` · `/read-all` · `POST/DELETE /push-devices` |
| **Audit log** | `GET /audit-logs` |
| **Pricing page and sign-up with free trial** | `GET /public/plans` → `POST /public/signup` → `/verify-email` → Stripe card → `/complete` · Enterprise: `POST /public/sales-enquiries` |
| **Plan, seats, billing cycle, payment method** | `GET /billing/subscription` · `/change-plan` · `PUT /billing/subscription/seats` · `/payment-method` · `POST /billing/card-setup` |
| **Subscription invoices and payments** | `GET /billing/invoices` · `/{id}` · `/{id}/pdf` · `POST /billing/invoices/{id}/bank-transfers` · `GET /billing/payments` · Stripe `POST /webhooks/stripe` |
| **Payment failure → grace → read-only** | Automatic (Stripe webhook + worker); visible in `GET /billing/history`; changes return 402 |
| **Cancel and data export** | `POST /billing/subscription/cancel` · `/resume` · `POST /billing/data-export` |
| **Owner console** | `GET /platform/metrics` · `/platform/tenants` · `/verify` · `/suspend` · `/extend` · `PATCH /platform/subscriptions/{id}` · `/platform/bank-transfers` → `/confirm` · `/platform/plans` · `/platform/settings` · `/platform/sales-enquiries` → `/create-company` · `/platform/audit-logs` |

## 11. Endpoints by section

| Section | Endpoints | Paths |
|---|---|---|
| Session | 2 | me, search |
| Organization | 25 | divisions, organization, permissions, roles, teams, users |
| Settings | 19 | currencies, lead-sources, lead-stages, reasons, settings |
| Leads | 27 | leads, saved-filters |
| Assignment | 5 | assignment-rules |
| Marketing | 11 | campaigns, events |
| Tasks | 5 | tasks |
| Meetings | 9 | availability, booking-pages, meetings |
| Public booking | 2 | public/booking |
| Messaging | 23 | conversations, leads, message-campaigns, message-templates |
| Projects | 22 | buildings, developers, projects, units |
| Deals | 7 | deals |
| Finance | 23 | commissions, counterparties, finance-documents |
| Attendance | 22 | attendance, attendance-policies, holidays, leave-requests, leave-types |
| Dashboard | 1 | dashboard |
| Reports | 7 | exports, integrations, reconciliations, reports |
| Integrations | 14 | integrations, oauth, webhook-events, webhook-sources |
| Files | 4 | attachments, files |
| Notifications | 5 | notifications, push-devices |
| Audit | 1 | audit-logs |
| Public sign-up | 6 | public/plans, public/sales-enquiries, public/signup |
| Subscription & billing | 15 | billing/card-setup, billing/data-export, billing/history, billing/invoices, billing/payments, billing/subscription, billing/usage |
| Owner console | 23 | platform/audit-logs, platform/bank-transfers, platform/billing-invoices, platform/billing-payments, platform/me, platform/metrics, platform/plans, platform/sales-enquiries, platform/settings, platform/subscriptions, platform/tenants |
| Webhooks (inbound) | 9 | webhooks |

Full details of every endpoint, field and response are in `api/openapi.yaml` and the API reference PDF.

## 12. How Swagger is generated and kept correct

1. **Contract first:** `api/openapi.yaml` is the agreed contract; this document and the reference are generated from it.
2. In the code, each NestJS controller uses `@nestjs/swagger` decorators; the app serves Swagger UI at `/api/docs` (disabled in production, or behind admin login).
3. **CI check:** on every pull request the build generates the spec from the code and compares it with `api/openapi.yaml`. Any difference fails the build until the contract is updated and approved. The screens' TypeScript API client is generated from the same file, so frontend and backend can never drift apart.

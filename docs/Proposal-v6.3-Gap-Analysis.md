# Prototype vs. Proposal v6.3 — Gap Analysis

Source: `Company_FB_DMS_SFA_Proposal_v6_3.docx` (Document FNB-DMS-SFA-PRO v2.0.0, last edited 6 Oct 2026).
Method: every feature, rule and status list in Sections 3 and 4 was compared with the prototype's screens
(`app/**/page.tsx`), data model (`prisma/schema.prisma`) and server actions (`app/actions/*.ts`).

Legend: ✅ covered · 🟡 partial (core flow works, proposal detail missing) · ❌ not in the prototype ·
⚪ not meaningful in a clickable prototype (simulated only)

**Verdict: the prototype covers the main flow of almost every module, but not every feature in the proposal.**
Tally of the 104 feature rows below: 3 ✅ fully covered, 90 🟡 partial, 6 ❌ missing, 5 ⚪ simulated only
(plus the offline engine, which is one ⚪ block). Most 🟡 rows are *working features that lack the
proposal's finer rules* — the "What is missing" column lists them.

---

## 3.2.1 Master Data (Module 2.1)

| Feature | Status | What is missing |
|---|---|---|
| Branch management | 🟡 | Region, manager email, effective dates; no block on deactivating a branch with open orders / pending receipts / van stock |
| Outlet profile & CRUD | 🟡 | Outlet code, owner name, mobile/landline/email, visit day; **duplicate check (name/address/GPS) absent**; no payment terms / price list on outlet |
| Customer onboarding workflow | 🟡 | Approve/reject with reason ✅. Missing: **Return for correction**, **Blocked** status (with release), approver ≠ creator rule, notifications |
| Product / SKU | 🟡 | Missing: brand, short name, selling units & pack conversion, minimum order qty, shelf-life days, **Discontinued** status, ERP-owned fields read-only, "cannot switch off lot flag while stock exists" |
| Channel & sub-channel | 🟡 | Channel *and* sub-channel create ✅. Missing: codes, channel active/inactive, reclassify-with-effective-date, "one sub-channel per outlet from that channel" enforcement |
| Territory & route | 🟡 | Territory, route, beat-plan sequence ✅. Missing: visit day / frequency, route status, "cannot inactivate route with outlets", route split |
| Sales personnel | 🟡 | Role, branch, route, supervisor ✅. Missing: employee code, contact, effective-dated status, block deactivation with open van stock / cash |
| Warehouse & van | 🟡 | Missing: location code, type (saleable / damaged / quarantine), status, "deactivate only at zero stock", van single-active-user check |
| Pricing engine & audit | 🟡 | Channel and customer rules with effective dates ✅, audit before/after ✅. Missing: base price lists, SKU/category markup, branch scope, visible precedence order |

## 3.2.2 Purchasing & Receiving (Module 2.2)

| Feature | Status | What is missing |
|---|---|---|
| PO review & status | 🟡 | List and status ✅. No formal **Exception** status/queue (unknown SKU, overdue, mismatch) |
| Goods receipt entry | 🟡 | Receipt vs expected ✅. Missing: Draft / Pending Review / Posted / Cancelled lifecycle, **variance reason**, tolerance → supervisor review, multiple deliveries per PO flow |
| Lot / expiry capture | 🟡 | Lot + expiry ✅. Missing: manufacturing date, multi-batch split per line with sum check, minimum shelf-life warning |
| Scan / attach documents | 🟡 | One attachment ✅. Missing: document type, description, multiple files, remove-before-post rule |
| Post to stock with traceability | 🟡 | Receipt→stock link ✅. Missing: pre-post checks, reversing entry for corrections |

## 3.2.3 Warehouse Inventory (Module 2.3)

| Feature | Status | What is missing |
|---|---|---|
| Inventory view | 🟡 | By warehouse/SKU/lot/expiry ✅ (filters, reserved qty). Missing: on-hand/allocated/available naming, days-to-expiry colour coding, movement drill-down, **Excel/PDF export** (CSV only) |
| Opening balances | 🟡 | Entry ✅. Missing: **template upload with line-by-line validation**, approval, lock after posting, batch log |
| Stock transfer | 🟡 | Request + approve ✅. Missing: **in-transit state**, receiving confirmation, shortage/damage discrepancy, value-based approval limits |
| Stock adjustment | 🟡 | Request + approve + reason codes ✅. Missing: configurable thresholds → approver by size/value, mandatory comment/attachment per reason |
| Physical / cycle count | 🟡 | Count + variance approval ✅. Missing: **blind count**, scoped counts (category/rack), recount, configurable tolerance, cycle schedules, movement freeze |
| Good vs bad segregation | 🟡 | Good/damaged + reversal ✅. Missing: **Quarantine** category, expired auto-move, supervisor approval for bad→good |
| **Returns to Central Warehouse** | 🟡 | **Built as "Returns to Principal / supplier return".** Proposal: return to Company F and B's *own central warehouse*; statuses Draft→Pending→Approved→In transit→Received→Posted to ERP; ERP notification; central-warehouse receipt confirmation |
| Near-expiry alerts | 🟡 | List with fixed 45-day window ✅. Missing: configurable bands (Healthy/Warning/Critical/Expired) per branch/category/SKU, daily alerts, value at risk, merchandising signal |
| FEFO allocation | 🟡 | Auto-FEFO reservation ✅. Missing: **suggest vs enforce mode**, override with recorded reason, minimum remaining shelf life |

## 3.2.4 Sales & Order Processing (Module 2.4)

| Feature | Status | What is missing |
|---|---|---|
| Order intake from SFA | 🟡 | Orders reach DMS ✅. Missing: device reference/duplicate rejection, exception list, order-level sync info |
| Backend order entry | 🟡 | Entry, shared pricing ✅. Missing: draft save, payment terms, **discount override request**, requested delivery date, remarks, source tag display |
| Order validation engine | 🟡 | Credit-limit and stock checks ✅. Missing: **overdue-receivables check**, duplicate-order check, price check, promotion ineligibility warning, configurable severity (warn/block), single results panel |
| Stock allocation | 🟡 | FEFO reservation ✅. Missing: allocation statuses, partial allocation + **backorder**, auto-release after timeout, reallocation on receipt |
| **Picklist** | ❌ | Only a "lots reserved" table on the order. No picklist document, number, picked qty, short-pick handling, grouping by route/date, status, reprint log |
| Invoice generation | 🟡 | Invoice + statuses ✅. Missing: per-branch gap-free number series, tax breakdown, PDF export, "Partially delivered" status wiring |
| Delivery receipt & partial delivery | 🟡 | Partial qty, adjusted invoice ✅. Missing: re-deliver / return-to-stock / cancel for the undelivered balance, delivery statuses (Out for delivery, Re-delivery scheduled), shortfall reason codes |
| Cancel / void | 🟡 | Void with approval, stock + AR reversal ✅. Missing: **cancellation of not-yet-invoiced orders**, status-based edit locking table, approval levels by value |

## 3.2.5 Van Inventory (Module 2.5)

| Feature | Status | What is missing |
|---|---|---|
| Replenishment request | 🟡 | **One product per request**; no multi-line request, requested vs approved qty, approve-with-reduced-qty, statuses Draft/Partially Approved/Loaded/Cancelled |
| Warehouse→van loading | 🟡 | Request, approve, rep confirm ✅. Missing: link to the approved request, loaded-vs-approved variance reason, "van stock sellable only after acknowledgement" |
| Van balance tracking | 🟡 | Live balance ✅. Missing: opening/loaded/sold/returned/closing view, last-synchronised |
| Van→warehouse returns | 🟡 | Return with condition ✅. Missing: declared vs received variance + status Variance Pending/Closed, link to claims |
| End-of-day reconciliation | 🟡 | Loaded−sold−returned vs count, confirm ✅. Missing: tolerance rules, hold-open on variance, supervisor approval, adjustment posting, "no reload until closed" |

## 3.2.6 Promotions, Discounts & Claims (Module 2.6)

| Feature | Status | What is missing |
|---|---|---|
| Promotion setup | 🟡 | Free goods, % off ✅ (prototype also lists price-off, rebate, volume). Missing: **bundle, value-based, quantity-slab**, max discount cap, days-of-week, budget/limit, stacking rule, Draft→Approved→Active→Suspended lifecycle, versioning, branch eligibility |
| Eligibility / override control | 🟡 | Auto-applied, shown per line ✅. Missing: discount-override request with supervisor decision on backend/field order, stacking/priority |
| Fixed customer discount | 🟡 | Standing % per outlet with dates ✅. Missing: product/category scope, **approval status**, history view |
| Promotion claims | 🟡 | Review/approve/reject/settle statuses ✅ (seeded). Missing: **creating a claim from qualifying transactions**, attach documents, "Returned for correction", Settlement Pending, claim-over-eligible-amount rule |

## 3.2.7 Finance & AR (Module 2.7)

| Feature | Status | What is missing |
|---|---|---|
| AR ledger per customer | 🟡 | Ledger ✅. Missing: credit status On Watch / On Hold / Blocked, available credit incl. open orders |
| Payment reconciliation | 🟡 | Reconcile ✅. Missing: bank transfer / other modes, pending-until-cleared cheques, bounced-payment reversal flow, unapplied-credit handling |
| Financial document workflows | 🟡 | Credit note (via market return) and AR reversal ✅. **Debit note, adjustment, write-off not built**; no value-based approval matrix |
| Ageing & credit controls | 🟡 | Ageing buckets ✅. Missing: customer hold/release, overdue-threshold blocking, configurable buckets, alerts |

## 3.2.8 Dashboards & Reporting (Module 2.8)

| Feature | Status | What is missing |
|---|---|---|
| Role dashboards | 🟡 | Admin, branch, supervisor, management dashboards ✅. Missing: shared filters (channel/route/rep), per-role tile configuration, last-refresh stamp |
| Standard report catalog | ❌ | No catalog / report-runner screen with the 11 listed reports and their filters |
| Excel & PDF export | 🟡 | CSV export button and Print/Save-as-PDF only; no Excel, no export permission or export log |
| Scheduled reports | 🟡 | Schedule list + pause ✅ (no real runs, history, failure notice) |
| Drill-down | 🟡 | Some links to documents; no breadcrumb/filter-carrying drill paths |

---

## 3.3.1 SFA — Access & Daily Workflow

| Feature | Status | What is missing |
|---|---|---|
| Secure login | ⚪ | Persona switcher, not real authentication: no password, device binding, PIN/biometric, lockout, password policy |
| Start / End day | 🟡 | GPS-stamped attendance ✅. Missing: open-items block on End Day, start-location check, clock-skew flag, supervisor reopen |
| Role-based home dashboards | 🟡 | Salesman home only; no supervisor or key-account home inside the app |
| Field activity summary | ❌ | No planned/completed/productive-call/time-in-market roll-up on the device |

## 3.3.2 SFA — Customer & Territory

| Feature | Status | What is missing |
|---|---|---|
| Customer profile | 🟡 | Profile ✅. Missing: **Change Request** action, last-order / top-products block |
| Route & coverage plan | 🟡 | Beat plan ✅. Missing: skip with reason, unplanned visit, Missed status, map view, sort by distance |
| Nearby outlets | 🟡 | Distance list ✅. Missing: radius selector, filters, map |
| GPS check-in / check-out | 🟡 | Capture ✅. Missing: distance-tolerance warn/block, reason on override, mock-location flag, one-open-visit rule |
| New customer from the field | 🟡 | Registration ✅. Missing: **photo**, duplicate flags, business registration ref, proposed route/visit day |

## 3.3.3 SFA — Sales & Orders

| Feature | Status | What is missing |
|---|---|---|
| Product catalog | 🟡 | Catalog + search ✅. Missing: images, brand/category/promoted filters, selling-unit conversion |
| Order capture | 🟡 | Cart, pricing, free goods, live quote, suggested qty ✅. Missing: draft/amend, reorder-last, pre-sales vs van-sale order type choice, minimum-order / pack-multiple rules |
| Credit check at order | 🟡 | Over-limit hold + approval ✅. Missing: near-limit warning, overdue message, data-age notice |
| Delivery scheduling | 🟡 | Requested date ✅. Missing: delivery calendar, cut-off/earliest date, urgent request |
| Digital signature | 🟡 | Signature ✅. Missing: signatory name mandatory, declined-to-sign reason |
| Order & invoice visibility | 🟡 | Order history ✅. Missing: invoice view, reprint-as-copy |

## 3.3.4 SFA — Van Inventory

| Feature | Status | What is missing |
|---|---|---|
| Stock request | 🟡 | Single product; no multi-line, approved-qty display or statuses |
| Loading / unloading confirmation | 🟡 | Load confirm ✅. Missing: unloading confirmation, issued-vs-received variance reason |
| Good/damaged marking | 🟡 | Mark + reverse ✅. Missing: photo, required-photo rule |
| Stock count | 🟡 | Count + apply ✅. Missing: count types, blind count, tolerance remark |
| Suggested order qty | ✅ | Rules-based from history |
| Mobile EOD | 🟡 | Stock reconciliation ✅. **Cash/cheque reconciliation and cash variance missing** |

## 3.3.5 SFA — Collections & Returns

| Feature | Status | What is missing |
|---|---|---|
| Receivables visibility | 🟡 | Balance/outstanding ✅. Missing: overdue age, ageing buckets, unapplied items, pending-sync mark |
| Cash & cheque collection | 🟡 | Amount + reference, oldest-first allocation ✅. Missing: **cheque bank/branch/date, post-dated handling, duplicate-cheque rule, manual allocation**, supervisor cancel |
| Receipt & Bluetooth print | ⚪ | On-screen receipt + browser print (printer simulated); no device number range, reprint-as-copy |
| Market returns | 🟡 | Capture → credit note ✅. Missing: reason list (Near Expiry, Wrong Item…), photo, signature, return-period rule |
| Credit note workflow | 🟡 | Proposed→applied ✅. Missing: status shown on device, approval limits |

## 3.3.6 SFA — Field Execution

| Feature | Status | What is missing |
|---|---|---|
| Visit feedback | 🟡 | Free-text only. Missing: structured outcome, no-order reason list, service rating, follow-up flag |
| Photo evidence | ❌ | Placeholder only — no capture, stamp, queue or upload status |
| Shelf audit | 🟡 | Free-text note only — no per-product availability / facings / expiry flag form |
| Task assignment & tracking | 🟡 | View and complete ✅. **Supervisor cannot create or assign tasks**; statuses limited (no Acknowledged / In Progress / Not Completed / Overdue) |
| Merchandising insight | 🟡 | Free-text note only — no structured fields |
| Competitor observation | 🟡 | Free-text note only — no brand list, price, promotion fields |

## 3.3.7 – 3.3.9 SFA — Supervisor, Workforce, Reporting

| Feature | Status | What is missing |
|---|---|---|
| Team dashboard | ✅ | Attendance, visits, sales, approvals |
| Coverage & call monitoring | 🟡 | Planned vs actual ✅. Missing: call-duration and location-variance flags |
| Exception approvals | 🟡 | Credit, discount, void, stock shortage, AR reversal ✅. Missing: return-outside-policy, out-of-route visit, escalation to next level |
| Scorecards | 🟡 | Scorecards ✅. Missing: targets, achievement %, trend, retained history |
| Gamification | ❌ | Not built (optional feature) |
| Attendance | ✅ | Start/end with GPS |
| Leave & expense | 🟡 | **Submit only — no supervisor approve/reject screen**; no attachments, balances |
| SFA reports | 🟡 | Coverage ✅. Missing: Field Activity, Orders, Collections, Sales, Van-Level Inventory report pages |

## 3.3.10 SFA — Offline & Synchronization

All items (durable offline store, controlled sync, retry, duplicate prevention, device sync status, admin
view of stale/errored devices) are ⚪ **simulated** — a sync-status widget exists, but there is no offline engine.

## 3.4 – 3.6 Integration, Security, AI

| Area | Status | Notes |
|---|---|---|
| Integration connectors, API gateway | ⚪ | Descriptive page only; no error queue, reconciliation, monitoring, BI feed |
| Branch scoping | 🟡 | Branch switcher; no multi-branch users or server-side enforcement |
| RBAC | 🟡 | Read-only permissions matrix; roles are a persona cookie, nothing enforced; no user create/bulk/role edit |
| SSO, MFA | ⚪ | Described only |
| Tamper-evident audit log | 🟡 | Append-only log with before/after ✅; no checksum chain, no export |
| Approval workflow | 🟡 | Queue handles credit, discount, void, shortage, AR reversal. Missing: configurable approvers/limits |
| Device & printer governance | ❌ | Not built |
| Optional AI capabilities | 🟡 | Mock insights panel only |

## 4. End-to-end flows

| Flow | Status | Gap |
|---|---|---|
| 4.1 New outlet registration | 🟡 | Missing duplicate check, photo, reviewer assigning price list / credit terms |
| 4.2 Order-to-cash | 🟡 | **No picklist step**; otherwise works end-to-end |
| 4.3 Van sales day | 🟡 | Request is single-product; EOD has no cash step or hold-open on variance |
| 4.4 Purchase-to-stock | 🟡 | Works; no ERP posting back, no exception queue |
| 4.5 Offline & sync | ⚪ | Simulated |
| 4.6 Promotion → claim settlement | 🟡 | **Cannot create a claim from qualifying orders**; claims are seeded |
| 4.7 Return to central warehouse | 🟡 | Built as supplier return; no Received / Posted-to-ERP states |

---

## Suggested order of work (if you want the prototype closer to v6.3)

1. **Terminology + flow fix:** rename Returns to Principal → *Returns to Central Warehouse*, add In transit / Received / Posted to ERP statuses.
2. **Visible gaps in the main flows:** picklist; duplicate-outlet check; supervisor task creation; leave/expense approval; claim creation from qualifying orders; multi-line van replenishment with approved quantity; cheque details; mobile EOD cash step.
3. **Master-data completeness:** outlet code/Blocked/Return-for-correction, product brand/Discontinued, branch deactivation checks, route visit day, employee code.
4. **Control rules:** overdue-receivables check, configurable near-expiry bands, FEFO suggest/enforce, bundle/slab/value promotions with stacking.
5. **Reporting:** report catalog, Excel/PDF export with log, Field Activity / Orders / Collections / Sales / Van reports.
6. Leave as described/simulated: SSO, MFA, encryption, offline engine, ERP/BI connectors, Bluetooth printer.

# Prototype vs. Proposal v6.3 — Coverage Matrix

Source: `Company_FB_DMS_SFA_Proposal_v6_3.docx` (Document FNB-DMS-SFA-PRO v2.0.0).
Method: every feature, rule and status list in Sections 3 and 4 was compared with the prototype's screens, data model and
server actions. This document replaces the earlier gap list: the gaps it recorded have been built, and each row now says
where to see the feature.

Legend: ✅ built and exercised in the prototype · ⚪ simulated — the behaviour is shown, but the production mechanism
(identity provider, device engine, ERP, printers) is not part of a clickable prototype.

**Verdict:** every module and every end-to-end flow in the proposal is represented. Items marked ⚪ are the integration and
device-level mechanisms the proposal itself describes as deployment concerns.

---

## 3.2.1 Master Data

| Feature | Status | Where / how |
|---|---|---|
| Branch management (region, contacts, effective dates, deactivation checks) | ✅ | Admin → Branches |
| Outlet profile, duplicate check, onboarding (Pending → Approved / Returned / Rejected, approver ≠ creator), Blocked with release | ✅ | Admin → Outlets, Onboarding Queue; Supervisor → Customer Onboarding |
| Product / SKU (brand, units, pack multiple, min order, Discontinued, ERP-owned fields) | ✅ | Admin → Products |
| Channel & sub-channel (codes, status, reclassify with effective date) | ✅ | Admin → Channels |
| Territory & route (visit day, frequency, status, split, move outlets) | ✅ | Admin → Territories, Routes |
| Sales personnel (employee code, status, deactivation checks) | ✅ | Admin → Sales Personnel |
| Warehouse & van (code, type, status, single active user) | ✅ | Admin → Warehouses & Vans |
| Pricing engine (precedence, base price, branch scope, audit) | ✅ | Admin → Pricing Engine (shows the precedence order) |

## 3.2.2 Purchasing & Receiving

| Feature | Status | Where / how |
|---|---|---|
| PO review, status, Exception queue | ✅ | Branch → Purchase Orders |
| Goods receipt Draft → Pending Review → Posted → Cancelled, variance reasons, tolerance review | ✅ | Branch → Purchase Orders → Receive |
| Lot / expiry / manufacturing date, multi-batch split, shelf-life warning | ✅ | Receive screen |
| Documents (type, description, multiple, remove before post), reversal of a posted receipt | ✅ | Receive screen |

## 3.2.3 Warehouse Inventory

| Feature | Status | Where / how |
|---|---|---|
| Inventory view (on-hand / allocated / available, lots, expiry colours, movement drill-down), Excel / PDF / CSV export | ✅ | Branch → Warehouse Stock; Reports → Stock on hand |
| Opening balances (template upload, line validation, approval, lock) | ✅ | Branch → Opening Balance |
| Stock transfer (in transit, receiving confirmation, discrepancies, value limits) | ✅ | Branch → Stock Transfers |
| Stock adjustment (reason codes, tiered approval by value) | ✅ | Branch → Stock Adjustments |
| Counts (blind, scoped, recount, tolerance) | ✅ | Branch → Stock Count |
| Good / damaged / expired / quarantine; bad → good needs approval | ✅ | Warehouse Stock, Approvals |
| Returns to Central Warehouse (Draft → … → Posted to ERP) | ✅ | Branch → Returns to Central Warehouse |
| Near-expiry bands, alerts, value at risk | ✅ | Branch → Near-Expiry Alerts; Reports → Near-expiry |
| FEFO allocation (suggest / enforce, override with reason, minimum shelf life) | ✅ | Order allocation, Platform Configuration |

## 3.2.4 Sales & Order Processing

| Feature | Status | Where / how |
|---|---|---|
| Order intake from SFA (device reference, duplicate rejection) | ✅ | Field app → New Order; replay never duplicates |
| Backend order entry (draft, terms, discount override, delivery date, source tag) | ✅ | Supervisor → Orders → New order |
| Validation engine (customer, quantity, pack multiple, price, promotion, credit, overdue, stock, duplicate; severity configurable) | ✅ | Backend order and field order check panels |
| Allocation (statuses, partial + backorder, auto-release, reallocation) | ✅ | Order detail |
| Picklist (number, picked qty, short picks, grouping, reprint log) | ✅ | Branch → Picklists |
| Invoice (per-branch series, VAT breakdown, PDF) | ✅ | Order detail; invoice page |
| Delivery receipt, partial delivery, undelivered balance (re-deliver / return / cancel) | ✅ | Branch → Deliveries |
| Cancel / void (before and after invoicing, value-based authority) | ✅ | Order detail, Approvals |

## 3.2.5 Van Inventory

| Feature | Status | Where / how |
|---|---|---|
| Multi-line stock request, requested vs approved quantity | ✅ | Field app → Van Stock; Branch → Van Stock Requests |
| Loading with variance, acknowledgement before stock is sellable | ✅ | Branch → Van Loading; van sales use only acknowledged stock |
| Van balances (opening / loaded / sold / returned / closing) | ✅ | Branch → Van Stock Balances |
| Van → warehouse returns with variance and status | ✅ | Branch → Van Returns |
| End-of-day reconciliation (tolerance, hold-open, supervisor approval, adjustment) | ✅ | Field app → End of Day; Branch → EOD Reconciliation |

## 3.2.6 Promotions, Discounts & Claims

| Feature | Status | Where / how |
|---|---|---|
| Promotion types: volume %, free goods (repeating), quantity slab, bundle, order-value, price-off, rebate | ✅ | Admin → Promotions → New |
| Cap, budget, redemption limit, stacking, priority, branch eligibility, days of week | ✅ | Promotion form; pricing engine resolves conflicts by the larger benefit |
| Lifecycle Draft → Approved → Active ⇄ Suspended → Expired; new versions; audit | ✅ | Promotion detail page |
| Fixed customer discount with approval, scope, history | ✅ | Admin → Customer Discounts |
| Claims created from qualifying delivered orders, documents, over-eligible exception, Returned for correction, Settlement pending, Settled | ✅ | Supervisor → Claims |

## 3.2.7 Finance & AR

| Feature | Status | Where / how |
|---|---|---|
| Customer ledger, credit status (Active / On watch / On hold / Blocked), available credit incl. open orders | ✅ | Supervisor → Credit Control |
| Payment modes (cash, cheque, bank transfer, other), cheque bank / branch / date, post-dated pending until cleared, duplicate-cheque rule, bounce + reversal, unapplied credit | ✅ | Supervisor → Payment Reconciliation; field app → Collect |
| Debit note, adjustment, write-off with value-based approval; credit note workflow with limits | ✅ | Supervisor → Debit / Credit / Write-off; Market Returns |
| Ageing (configurable buckets), overdue thresholds, automatic watch / hold, alerts | ✅ | Supervisor → AR Aging, Credit Control |

## 3.2.8 Dashboards & Reporting

| Feature | Status | Where / how |
|---|---|---|
| Role dashboards on a shared framework (customer, route, sales, inventory, purchasing, claims, receivables) with branch / date / channel / route / rep filters, last-refresh stamp, auto-refresh, drill-down | ✅ | Dashboards in the Admin, Branch, Supervisor and Management areas |
| Head-office consolidated view: receivables ageing, collections, credit holds, market / van / central-warehouse returns and open claims for every branch side by side, with drill-down; network ageing by branch, route or customer; returns register | ✅ | Admin and Management → Branch Network View; Reports → Returns register, Receivables ageing (group by); Returns dashboard |
| Standard report catalog — the 11 reports plus the field-force reports, per-report permission, filters, header block | ✅ | Reports in each area |
| Excel / CSV / PDF export, separate export permission, export log | ✅ | Every report; audit trail export |
| Scheduled reports (relative dates, owner scope, run history, report inbox, failure notice and repeat) | ✅ | Admin → Scheduled Reports |

## 3.3 Field Sales (SFA)

| Feature | Status | Where / how |
|---|---|---|
| Secure sign-in: registered approved device, PIN, lockout, unlock | ✅ (identity provider ⚪) | Field app login; Admin → Devices |
| Start / end day with GPS, late start, clock-skew flag, open-items block, supervisor reopen | ✅ | Field app → Attendance; Supervisor → Team Dashboard |
| Home dashboards (rep and supervisor), field activity summary, targets | ✅ | Field app home |
| Customer profile (balance, ageing, unapplied credit, last order, top products, change request) | ✅ | Field app → outlet |
| Route plan (statuses, skip with reason, unplanned visit, sort by distance, map), nearby outlets (radius, filters, map) | ✅ | Beat Plan, Nearby |
| GPS check-in / out (tolerance warn / block, override reason, mock-location flag, one open visit, duration flags) | ✅ | Visit |
| New customer (photo, duplicate flags, registration reference, proposed route / day, resubmit when returned) | ✅ | New Customer |
| Order capture: catalogue filters, units / packs, pre-sales vs van sale, drafts, reorder last, suggested qty, minimum / pack rules, credit and overdue messages, data-age notice, delivery calendar with cut-off and urgent, signature with name or declined reason | ✅ | New Order |
| Van stock: multi-line request, acknowledgement, damage with photo rule, counts, EOD with cash | ✅ | Van Stock, End of Day |
| Collections: cash / cheque / transfer, receipts, reprint as copy (limited), market returns (reasons, photo, signature, return period, exception) | ✅ | Collect, Returns |
| Field execution: structured visit feedback, photo evidence, shelf audit, merchandising insight, competitor observation | ✅ | Visit, Field Forms |
| Tasks created by supervisors; Acknowledged / In progress / Completed / Not completed / Overdue; photo proof | ✅ | Supervisor → Task Assignment; field app → My Tasks |
| Team dashboard, coverage with call-duration and location flags, exception approvals with escalation | ✅ | Supervisor → Team Dashboard, Coverage, Approvals |
| Scorecards with targets, achievement %, 6-month trend; recognition (badges, leaderboard) | ✅ | Supervisor → Scorecards, Targets; field app → Scorecard |
| Leave and expense with balances, attachments, supervisor approval | ✅ | Field app → Leave & Expenses; Supervisor → Leave & Expense Approvals |
| SFA reports | ✅ | Field app → Reports |
| Offline capture, durable queue, controlled sync, duplicate prevention, device sync status | ✅ (device database ⚪) | Sync centre; Admin → Devices |

## 3.4 – 3.6 Integration, Security, AI

| Area | Status | Where / how |
|---|---|---|
| Integration connectors, gateway log, error queue with resend, reconciliation, BI extracts | ✅ (live connections ⚪) | Admin → Integrations & Gateway |
| Branch scoping enforced on the server; multi-branch users | ✅ | All reports, dashboards, lists |
| RBAC: roles × modules × levels, enforced on screens and actions | ✅ | Admin → Permissions |
| SSO, MFA | ⚪ | Enrolment gate with demo code; configuration in Platform Configuration |
| Tamper-evident audit log (hash chain, verification, export) | ✅ | Admin → Identity & Audit Integrity, Audit Log |
| Approval workflow: value limits, head-office-only types, escalation, separation of duties | ✅ | Admin → Approval Authority; Supervisor → Approvals |
| Device & printer governance | ✅ (Bluetooth printing ⚪) | Admin → Devices |
| Optional AI capabilities | ⚪ | Insights panel marked as a separately priced option |

## 4. End-to-end flows

| Flow | Status | Covered by |
|---|---|---|
| 4.1 New outlet registration | ✅ | Field registration → supervisor review → route and credit terms assigned |
| 4.2 Order-to-cash | ✅ | Order → validation → allocation → picklist → invoice → delivery → payment |
| 4.3 Van sales day | ✅ | Request → load → acknowledge → sell → collect → return → EOD |
| 4.4 Purchase-to-stock | ✅ | PO → receipt → variance review → post → ERP message |
| 4.5 Offline & sync | ✅ (⚪ engine) | Offline queue and sync centre |
| 4.6 Promotion → claim settlement | ✅ | Promotion → qualifying orders → claim → review → settlement |
| 4.7 Return to central warehouse | ✅ | Central return with ERP posting states |

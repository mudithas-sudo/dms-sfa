# Client demonstration guide — Company F and B DMS & SFA

Live prototype: https://dms-sfa-6uoh.vercel.app/admin
Allow about 40 minutes: 30 of demonstration, 10 for questions. Every step below uses data that is already loaded.

## Before the meeting

| When | Do this |
|---|---|
| Morning of the demo | From the project folder run `npx tsx prisma/seed-showcase.ts`. It tops up deliveries waiting and on the road at every branch, and today's field activity for every representative (so "Team Dashboard — Today" is not empty). Safe to run more than once. Takes a few minutes. |
| 10 minutes before | Open the app and click through three or four screens. The database sleeps when idle and the first page can take several seconds to wake it; after that, pages load in about a second. |
| Set up two windows | Window 1: normal width for the desktop screens. Window 2: narrow (or the browser's phone view) at `/sfa` for the field app. |
| After a rehearsal | Rerun the command above. "Record delivery" uses up a waiting delivery, and the command puts them back. |

Switching person: use the three pills at the top right (role, branch, user). In the field app they are under "Demo: switch role or user".

| Role | Branch | User |
|---|---|---|
| Central Administrator | all | Maria Santos |
| Branch / Warehouse Operations | Cebu | Pedro Aguilar |
| Sales & Finance Supervisor | Cebu | Grace Lim |
| Sales Representative | Cebu | Rico Delos Santos (5 stops today) or Josephine Tan |
| Management | all | (read-only dashboards) |

Field app PIN for every representative: **1234**.

## The story (one thread, told in this order)

The company sells to outlets through three distribution branches. Head office wants to see all of them; each branch runs its own warehouse, vans and delivery; supervisors control orders, credit and approvals; field reps sell on a phone. One order travels through all of it.

### 1. Head office sees everything (5 min) — Central Administrator
1. **Head Office Overview.** Sales against target, receivables, collections, returns, stock value, near-expiry lots. Point at "Needs head-office attention": every tile is a queue someone must act on, and each one opens it.
2. **Receivables — All Branches** and **Returns — All Branches.** Ageing by branch side by side; returns by branch including those outside policy and awaiting a credit note.
3. **Branch Network View.** Click a branch figure to open its detail. Message: head office never has to phone a branch for a number.
4. Quick look at **Outlets**, **Products**, **Routes & Beat Plans**: master data owned centrally.

### 2. Commercial rules in one place (4 min) — still Central Administrator
- **Pricing Engine**, **Customer Discounts**, **Promotions.** Message: the same rules price an order whether it is keyed at the branch or taken on a phone; nobody types a price.

### 3. A rep takes an order in the field (8 min) — Sales Representative, phone width
1. `/sfa/login` → pick Rico, PIN 1234. Back on Home: "Start your day", today's targets, orders waiting for approval.
2. **Beat plan** (Home → route): today's stops as a timeline, the dashed route on the map, skip a stop with a reason, "Nearest first" sorting.
3. **New order.** Choose a customer: credit limit, what they owe and what is available show at once. Add products; prices and promotions apply live; the checks panel passes, warns or blocks. Show "Reorder last" and "Suggested quantities".
4. **Collect** a payment and **Visit** check-in (location verified). **Van** shows van stock. **Sync centre** shows the offline queue: orders captured offline are stored and sent later, and a resend never creates a duplicate.

### 4. The supervisor controls it (7 min) — Sales & Finance Supervisor (Cebu)
1. **Approvals.** Credit-limit exceptions, stock shortages, adjustments waiting for a decision. Approve one, reject one with a note; show "Escalate to head office".
2. **Orders (Void Requests).** Filter "On hold / exceptions": nothing is silently lost; each held order says why. Open **New Backend Order**: the same validation engine, live.
3. **Credit Control**, **AR Aging**, **Payment Reconciliation.** Who owes what, who is over limit, cheques against bank.
4. **Team Dashboard — Today.** Each rep's start time, visits, route coverage and flags, as the day happens.
5. Mention **E-Invoicing & Tax**, **Claims Review**, **Market Returns**, **Targets**, **Coverage Monitoring**: all there if asked.

### 5. The branch fulfils it (7 min) — Branch / Warehouse Operations (Cebu)
1. **Warehouse Stock** and **Near-Expiry Alerts.** Stock by lot and expiry; allocation follows first-expiry-first-out; lots close to expiry are flagged before they become losses.
2. **Picklists.** Orders grouped, bin locations, pick confirmation.
3. **Deliveries** (the headline screen). Each invoice is a tracking card: customer, address, amount, progress line with the truck, a call button, and the delivery run map beside it.
   - **Mark out for delivery** on the waiting one.
   - **Record delivery** on one: type the received quantity as *less* than invoiced, give a shortfall reason, a name and a signature. Message: the receivable follows what was *delivered*, and the shortfall becomes an undelivered balance that cannot be forgotten.
   - Scroll to **Undelivered balances**: re-deliver, return to stock or cancel.
4. **Van Loading**, **Van Returns**, **End-of-Day Reconciliation.** Vans are loaded, counted back and reconciled daily.

### 6. Management and governance (4 min)
- **Management** persona: cross-branch dashboards, read-only. Show a report from the **Report Catalog** and "Print / Save as PDF".
- Back as Central Administrator: **Permissions (RBAC)** (what each role may see or do), **Audit Log** (who did what, when), **Approval Authority**, **Platform Configuration** (limits and thresholds changed without a software release), **Integrations & Gateway** (ERP, e-invoice and merchandising exchanges).

## Close (1 min)
One order, one set of rules, visible from the phone in the field to head office. Everything shown is configurable, role-controlled and audited.

## Be ready for these questions
- **"Is this connected to our ERP?"** Integrations are simulated in the prototype; the screens show the exchanges, retries and error queue that the real connection will use.
- **"Does it work offline?"** The sync centre demonstrates the behaviour: capture offline, send later, no duplicates. The "Work offline" switch is a demo control.
- **"Is the data real?"** No. It is sample data built for the demonstration.
- **"Can we change the colours and labels?"** Yes; the look is driven by one design system.

## Avoid during the demo
- Do not click **Record delivery** more than needed; each use consumes a waiting delivery (rerun the showcase command to restore them).
- Do not open the prototype with a stale tab from before today: refresh it so the field data shows today's date.
- If a page seems slow once, it is the database waking up; carry on talking and it will not repeat.

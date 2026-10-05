# Company F and B — DMS Solution Walkthrough

**Purpose:** This document pairs each capability described in Section 3 (Distributor Management System) of the technical proposal with exactly how it is demonstrated in the working prototype — which screen to open, which role to be in, what to click through, and what the underlying logic actually does. It is written so it can be used directly as a screenshot capture script and/or a demo run-sheet.

**How to read this document**

- Every feature heading below matches the proposal's own heading, in the same order.
- **What the proposal describes** briefly restates the requirement.
- **How the prototype demonstrates it** explains the concrete screen(s), role, and workflow, and is honest about what is a real working mechanism versus a labeled simulation (e.g. "ERP sync" and "BI feed" are static indicators, not live integrations — this is intentional prototype scope, not a gap).
- **📸 Screenshot(s) needed** tells you exactly what to capture and from where. Capture these using the role switcher in the app header (this prototype has no real login — switching Role / Branch / User in the header is the equivalent of "logging in" as that person).

Since there is no real authentication, every screen reference below assumes you have first set the header's **Role** dropdown to the role named in that section (Central Administrator / Branch / Warehouse Operations / Sales & Finance Supervisor / Field Sales Representative / Management & Reporting), and picked a **Branch** and **User** where relevant.

---

## Table of Contents

- [3.1 Central Administrators](#31-visibility--capabilities--central-administrators)
  - [3.1.1 Master Data Management](#311-master-data-management)
  - [3.1.2 Pricing Engine & Promotion Configuration](#312-pricing-engine--promotion-configuration)
  - [3.1.3 Audit Trail & Governance](#313-audit-trail--governance)
  - [3.1.4 Enterprise Reporting & BI Feed](#314-enterprise-reporting--bi-feed)
- [3.2 Branch / Warehouse Operations](#32-visibility--capabilities--branch--warehouse-operations)
  - [3.2.1 Purchasing & Receiving](#321-purchasing--receiving)
  - [3.2.2 Warehouse Inventory Management](#322-warehouse-inventory-management)
  - [3.2.3 Ready Stock Delivery / Van Inventory](#323-ready-stock-delivery--van-inventory)
- [3.3 Sales & Finance Supervisors](#33-visibility--capabilities--sales--finance-supervisors)
  - [3.3.1 Sales & Order Processing](#331-sales--order-processing)
  - [3.3.2 Promotions, Discounts & Claims](#332-promotions-discounts--claims)
  - [3.3.3 Finance & Accounts Receivable](#333-finance--accounts-receivable)
  - [3.3.4 Team Performance & Coverage Monitoring](#334-team-performance--coverage-monitoring)
- [3.4 Management & Reporting Users](#34-visibility--capabilities--management--reporting-users)
  - [3.4.1 Reporting & Analytics](#341-reporting--analytics)

---

## 3.1 Visibility & Capabilities — Central Administrators

**Role to select:** Central Administrator

### 3.1.1 Master Data Management

#### Branch Management

**What the proposal describes:** Each branch is a master record — name, code, address, contact details, and an active/inactive status that governs whether it can transact. Deactivating a branch is controlled, not a deletion: history stays intact, only new activity is blocked.

**How the prototype demonstrates it:** Admin → **Branches** (`/admin/branches`) lists every branch with its Code, Address, and Status, plus counts of the outlets/warehouses/vans anchored to it. **New Branch** (`/admin/branches/new`) and **Edit Branch** (`/admin/branches/[id]`) capture Name, Code, Address, Contact Person, Contact Phone, and Status. The Active/Inactive status is not cosmetic: setting a branch to Inactive is checked by the order-submission logic on both the SFA and DMS backend-order paths, and a transaction against an inactive branch is blocked outright — matching "governs whether the branch can transact" literally, not just as a display label.

**📸 Screenshot(s) needed:**
1. Branches list page, showing the Code / Address / Outlets / Warehouses / Vans / Status columns.
2. Edit Branch form, showing the Code, Contact Person, Contact Phone and Status fields.

#### Customer (Outlet) Master

**What the proposal describes:** Every outlet is a master record with name, address, GPS, contact person, channel/sub-channel, route, and owning branch. It can be created centrally or registered from the field, but either path goes through the same onboarding/approval workflow before it becomes active and sellable. Once active, it can be edited (address, contact, channel) or deactivated — never deleted.

**How the prototype demonstrates it:** Admin → **Outlets → New Outlet** (`/admin/outlets/new`) captures the full field set including Contact Person and GPS latitude/longitude. The field-registration path is **SFA → New Customer** (`/sfa/customers/new`) — a rep captures the same information and submits it; the new outlet is created `inactive` with `onboardingStatus: pending`. Both paths land in Admin → **Onboarding Queue** (`/admin/outlets/onboarding`), where an admin approves (outlet becomes active and immediately orderable) or rejects with a reason. The **Edit Outlet** form (`/admin/outlets/[id]`) allows changing every one of these fields after creation — branch, channel, sub-channel, route, address, GPS, contact person, credit limit, status — there is no delete action anywhere on outlets.

**📸 Screenshot(s) needed:**
1. SFA "New Customer Registration" form (captured while in Field Sales Representative role).
2. Admin Onboarding Queue showing the pending outlet with its submitted details and the Approve/Reject buttons.
3. Outlet edit form showing the full set of editable fields (branch/channel/sub-channel/route/address/GPS/contact).

#### Product/SKU Master

**What the proposal describes:** Products are centrally maintained with a unique code, name, UOM, pack size, and category. Shelf-life-sensitive items carry a lot/expiry tracking flag that switches on batch capture and FEFO downstream. Changes propagate to every branch and the SFA catalog through the same sync that keeps pricing current.

**How the prototype demonstrates it:** Admin → **Products** (`/admin/products`) — New/Edit forms capture SKU, Name, UOM, Pack Size, Category, Unit Price, the "has expiry / lot tracking" checkbox, and Status, all editable after creation. Because the SFA app reads the same `Product` table directly rather than a separately-synced copy, editing a product here (e.g. its price or category) is reflected the next time the SFA order screen renders — with no separate propagation step, which is the prototype's way of proving "field staff are never selling from a stale list."

**📸 Screenshot(s) needed:**
1. Products list page.
2. Product edit form, showing the Pack Size field and the expiry-tracking checkbox.
3. The same product/price shown live on the SFA order screen immediately after the edit.

#### Channel & Sub-Channel Master

**What the proposal describes:** Outlets are classified into channels and finer sub-channels; this classification drives pricing and promotion eligibility and channel-cut reporting. Reclassifying an outlet re-evaluates which rules apply going forward.

**How the prototype demonstrates it:** Admin → **Channels** (`/admin/channels`) lists each channel (General Trade, Key Accounts, Modern Trade) with its sub-channels and an inline "add sub-channel" form. Reclassification happens through the Outlet edit form's Channel and Sub-Channel fields — because pricing and promotion matching look up `outlet.channelId` live at the moment an order is placed (not from a cached value), a channel change takes effect on the very next order for that outlet.

**📸 Screenshot(s) needed:**
1. Channels page showing the sub-channel lists per channel.
2. Outlet edit form's Channel / Sub-Channel fields.

#### Territory & Route Master

**What the proposal describes:** A territory groups outlets geographically/organizationally; routes within it are the fixed "beat plan" sequence a rep visits. This drives the rep's daily route view and the planned-vs-actual coverage comparison. Routes can be restructured, taking effect at the field user's next sync.

**How the prototype demonstrates it:** Admin → **Territories** (`/admin/territories`) is a dedicated master-data screen (Name, Code, Status). Admin → **Routes & Beat Plans** (`/admin/routes`) creates routes under a chosen territory; each route's detail page (`/admin/routes/[id]`) lets an admin add or remove outlets as numbered stops, with the sequence automatically re-numbered when a stop is removed. The rep sees this exact sequence on the **SFA home screen** and the dedicated **Beat Plan** page (`/sfa/route`); Supervisor → **Coverage Monitoring** (`/supervisor/coverage`) compares it against actual GPS check-ins for the day.

**📸 Screenshot(s) needed:**
1. Territories page.
2. A route's detail page showing its numbered beat-plan stops.
3. The SFA Beat Plan view showing the same sequence on the rep's device.

#### Sales Personnel Master

**What the proposal describes:** Employee records capture identity, branch, route, and reporting supervisor. Reassignment is a master-data change that immediately reflects in what that user (and their supervisor) sees — no separate reconfiguration step.

**How the prototype demonstrates it:** Admin → **Sales Personnel** (`/admin/personnel`) lists every branch-ops/supervisor/sales-rep user with inline reassignment controls — a Branch dropdown for every role, a Route dropdown for reps, and a Supervisor dropdown for reps and branch-ops staff — plus a **New Personnel** form (Name, Role, Branch). These are live foreign keys read fresh on every page load, so reassigning a rep's branch or route immediately changes their own `/sfa` customer list and route plan, and their supervisor's Team Dashboard, without any extra step.

**📸 Screenshot(s) needed:**
1. Sales Personnel page with the inline reassignment dropdowns visible.
2. New Personnel creation form.

#### Warehouse & Van Master

**What the proposal describes:** Every warehouse and van is a distinct, identified inventory location. Vans are linked to their assigned salesperson/driver so van stock movements post to the correct location automatically.

**How the prototype demonstrates it:** Admin → **Warehouses & Vans** (`/admin/warehouses-vans`) lists every warehouse (Name, Branch, Stock Lot count) and van (Code, Plate No., Branch, Assigned Rep), each with inline reassignment and "New Warehouse" / "New Van" creation forms. Critically, a van's assigned rep is a real foreign key (`Van.assignedUserId`) to the personnel record — not a loosely-matched name string — so every SFA van-stock lookup resolves through this link, which is what makes assigning a rep to a van here the thing that determines whose `/sfa/van-stock` screen shows that van's inventory.

**📸 Screenshot(s) needed:**
1. Warehouses & Vans page, with the Assigned Rep column visible.
2. New Van creation form showing the rep-assignment dropdown.

#### Change History

**What the proposal describes:** Every creation, edit and deactivation across master data is logged automatically with who, before/after values, and when — reviewable per record without raising an IT request.

**How the prototype demonstrates it:** Admin → **Audit Log** (`/admin/audit-log`) is a single chronological feed spanning Branch, Outlet, Product, Sub-Channel, Territory, Route, Personnel, Warehouse and Van changes. Each entry captures a JSON before/after snapshot of the exact fields changed, not just a text summary — demonstrated by editing a branch's address and then opening the audit log to see the old and new address both recorded against that entry.

**📸 Screenshot(s) needed:**
1. Audit Log page, ideally with one entry expanded/inspected to show its before/after values (ask the developer to show the raw snapshot if the UI doesn't expand it inline).

### 3.1.2 Pricing Engine & Promotion Configuration

#### Pricing Rules

**What the proposal describes:** Channel-level markup rules, optionally overridden at customer or SKU level, effective-dated, shared identically between the DMS backend and the SFA app.

**How the prototype demonstrates it:** Admin → **Pricing Rules** (`/admin/pricing`) creates a rule at Channel or Customer level, as a Fixed Price or a Discount %, with a Start Date and optional End Date. The identical lookup runs inside both `submitOrder` (SFA) and the DMS backend order-entry action — active rules are matched where `startDate` has passed and `endDate` is either open or in the future, a customer-level match wins over a channel-level one, and the resulting price is what both a field rep and a supervisor entering a backend order see for the same customer and product.

**📸 Screenshot(s) needed:**
1. New Pricing Rule form, showing the Start/End Date fields.
2. The identical price shown for the same outlet/product in both the SFA order cart and the DMS backend "New Backend Order" screen.

#### Promotion Setup

**What the proposal describes:** A promotion is configured once — eligible products/channels, an eligibility condition (e.g. minimum quantity), an active date range, and the discount-or-free-good calculation — and applies automatically wherever an eligible order is placed. It stops applying by itself once its date range ends.

**How the prototype demonstrates it:** Admin → **Promotions → New Promotion** captures Type (Volume Discount / Free Good / Price-Off / Rebate), Product, Channel, a structured Minimum Qty, and either a Discount % or a Free-Units count, with Start/End Date. The same matching rule (product match, channel match, minimum-qty eligibility) runs in both the SFA and backend order paths and computes either a percentage discount or a free-goods deduction depending on type; once `endDate` passes, the promotion simply stops matching new orders.

**📸 Screenshot(s) needed:**
1. New Promotion form, showing Type / Channel / Minimum Qty fields.
2. An order line (SFA or backend) showing the promotion discount applied automatically.

#### Fixed Customer Discounts

**What the proposal describes:** A standing discount percentage per outlet — a negotiated arrangement, not a campaign — applied automatically until changed, kept separate from the promotion calendar.

**How the prototype demonstrates it:** Admin → **Customer Discounts** (`/admin/customer-discounts`) creates a customer-level pricing rule with no end date, so it behaves as an always-on arrangement, while remaining on its own dedicated screen rather than mixed into the time-bound Promotions list.

**📸 Screenshot(s) needed:**
1. Customer Discounts page and its creation form.

#### Discount Override Control

**What the proposal describes:** Any discount beyond configured rules is blocked by default, not left to whoever is entering the order. The request (with a reason) routes to the supervisor for approval or rejection, and the outcome is always audited.

**How the prototype demonstrates it:** This is one of the four standing exception types (alongside credit-limit, stock-shortage and price-promo-mismatch) that lands as a pending `ApprovalRequest` on Supervisor → **Approvals** (`/supervisor/approvals`), showing the requested discount, the reason given, and the order it applies to. Approve/Reject with an optional decision note; every past decision remains visible in the Decision History table on the same page.

**📸 Screenshot(s) needed:**
1. Supervisor Approvals page showing a pending Discount Override request.

### 3.1.3 Audit Trail & Governance

#### Change Logging

**What the proposal describes:** A single, tamper-evident logging service underneath every module — master data, stock movements, pricing/promotion changes, financial postings — not separate module-level logs.

**How the prototype demonstrates it:** The same `AuditLog` table and logging pattern used for master data (Section 3.1.1) is also used for stock-related events (damage reclassification, stock adjustments) and financial postings (order voids, AR reversals) — demonstrated by performing one action from each of these three areas and showing all three appear together in the one Audit Log feed, in the order they happened, without needing to know in advance which module to check.

**📸 Screenshot(s) needed:**
1. Audit Log page showing a mix of entity types (e.g. a Branch edit, a stock damage event, and an order void) together in one feed.

#### No Hard Deletion

**What the proposal describes:** Once a transaction passes a defined status, it's locked against direct edit/delete. Corrections go through an approved reversal or void: the stock/financial impact is reversed, and the original entry stays visible in history, marked voided or reversed rather than erased.

**How the prototype demonstrates it:** There is no delete action anywhere on Branch, Outlet, Product, SalesOrder, Invoice, or AR ledger entries — status flags do the work instead. Two concrete walkthroughs: (1) **order void** — Supervisor → Orders → "Request Void" on an invoiced order → Approvals → Approve; the order and invoice both flip to "Voided," a `void_reversal` AR entry is posted, and the original rows stay fully visible with their new status badge; (2) **AR reversal** — Supervisor → Payment Reconciliation → "Request Reversal" on a posted payment → Approvals → Approve; an offsetting ledger entry is posted rather than editing or deleting the original payment.

**📸 Screenshot(s) needed:**
1. A voided order still visible in the Orders list, showing its "Voided" status badge.
2. The AR ledger showing an original payment and its reversal entry side by side.

#### Role & Access Management

**What the proposal describes:** Admins create accounts, assign a role, and scope access to a branch. Role changes take effect at next login and are themselves logged.

**How the prototype demonstrates it:** Account creation and branch/route/supervisor assignment happen on Admin → **Sales Personnel** (Section 3.1.1). Admin → **Permissions (RBAC)** (`/admin/permissions`) is a reference view of the role-to-capability matrix. Because this prototype simulates login via the header's role/branch/user switcher rather than real authentication, a role or scope change takes effect the moment that switcher selection changes — the direct equivalent of "next login" in a system with real sessions.

**📸 Screenshot(s) needed:**
1. Permissions (RBAC) matrix page.
2. The role/branch/user switcher control in the app header.

### 3.1.4 Enterprise Reporting & BI Feed

#### Reporting Configuration

**What the proposal describes:** Admins define and maintain the standard dashboard/report catalog available to branch, supervisory and management users.

**How the prototype demonstrates it:** Admin → **Scheduled Reports** (`/admin/scheduled-reports`) is the concrete configuration surface — a named report (Sales Summary / AR Aging / Inventory Valuation / Claims Status), a schedule description, recipient emails, and an active/inactive toggle. The broader "standard dashboard catalog" itself is the fixed set of built-in dashboards on the Branch, Supervisor and Management screens — there is intentionally no separate report-builder at prototype scope.

**📸 Screenshot(s) needed:**
1. Scheduled Reports page with a report configured and toggled Active.

#### BI Feed

**What the proposal describes:** A single, governed outbound feed carrying DMS data to the business intelligence environment on an agreed schedule.

**How the prototype demonstrates it:** Simulated as a clearly labeled static indicator rather than a real integration, consistent with the prototype's "no real ERP/BI connections — stub with a static indicator" scope. The Management dashboard header shows "Last exported to BI: Today 06:15 AM (stubbed BI feed)," and Admin → **Integrations & Platform** (`/admin/integrations`) lists the Business Intelligence Environment among five integration points, each with a "Simulated" status badge and a last-sync timestamp.

**📸 Screenshot(s) needed:**
1. Integrations & Platform page, showing the Business Intelligence Environment row.
2. Management dashboard's "Last exported to BI" line.

---

## 3.2 Visibility & Capabilities — Branch / Warehouse Operations

**Role to select:** Branch / Warehouse Operations

### 3.2.1 Purchasing & Receiving

#### Purchase Order Review

**What the proposal describes:** A worklist of POs with status (pending / partially received / fully received), plus an exception queue for anything overdue against its expected delivery date.

**How the prototype demonstrates it:** Branch → **Purchase Orders** (`/branch/purchase-orders`) lists every PO with its status badge, and shows a separate rose-highlighted **"Exception Queue — Overdue Expected Date"** section above the main list for any PO still open past its expected date. Each PO's detail page (`/branch/purchase-orders/[id]`) shows its ordered lines and every goods receipt posted against it.

**📸 Screenshot(s) needed:**
1. Purchase Orders page showing both the Exception Queue and the full worklist with status badges.

#### Goods Receipt Entry

**What the proposal describes:** Record actual quantity received per line; shortage/overage flagged automatically; batch number and expiry captured at receipt for lot-tracked SKUs.

**How the prototype demonstrates it:** Branch → Purchase Orders → **Receive Goods** (`/branch/purchase-orders/[id]/receive`) is a line-by-line form where a quantity that differs from what was ordered is visually flagged, with Lot Number and Expiry Date inputs shown per line (expiry only for lot-tracked products). Submitting posts the received quantity into the warehouse stock balance and automatically updates the PO's status to partially or fully received.

**📸 Screenshot(s) needed:**
1. Receive Goods form, showing the quantity-variance highlighting and the lot/expiry inputs.

#### Receiving Documentation

**What the proposal describes:** A scanned or photographed copy of the delivery document can be attached directly to the receipt.

**How the prototype demonstrates it:** The same Receive Goods form has a real file picker. Since the prototype has no backing file-storage service, only the selected filename is persisted and shown alongside the receipt (clearly a stub, not a real upload) — visible afterward on the PO detail page next to the goods receipt it belongs to.

**📸 Screenshot(s) needed:**
1. The file-attachment control on the Receive Goods form.
2. The attached filename shown on the PO detail page.

#### Stock Posting

**What the proposal describes:** Posted receipts link back to their originating PO and receipt record, giving full traceability from a unit of stock back to its delivery.

**How the prototype demonstrates it:** Every stock lot created from a goods receipt carries a link back to the exact receipt line it came from. Branch → **Warehouse Stock** (`/branch/warehouse-stock`) has a "Source PO" column that goes straight from a stock lot to its originating purchase order's detail page.

**📸 Screenshot(s) needed:**
1. Warehouse Stock page's Source PO column, with one row's link followed through to its PO detail page.

### 3.2.2 Warehouse Inventory Management

#### Stock Visibility

**What the proposal describes:** View and filter current inventory by branch, warehouse, SKU, lot, and expiry date.

**How the prototype demonstrates it:** Branch → **Warehouse Stock** (`/branch/warehouse-stock`) has filter fields for SKU/product name, Lot number, and "Expiring Before" a chosen date, alongside SKU / Product / Lot / Expiry / Qty Good / Reserved / Qty Damaged / near-expiry flag columns for every stock row.

**📸 Screenshot(s) needed:**
1. Warehouse Stock page with all three filters populated and a filtered result shown.

#### Beginning Balances

**What the proposal describes:** Opening stock entered per warehouse/SKU at go-live; later corrections subject to the same approval and audit controls as any other adjustment.

**How the prototype demonstrates it:** Branch → **Opening Balance** (`/branch/opening-balance`) creates a pending stock adjustment (reason "opening balance") rather than posting directly — it must be approved on **Stock Adjustments** before the balance is actually created, so an opening-balance entry is never a silent bypass of the normal adjustment control.

**📸 Screenshot(s) needed:**
1. Opening Balance page showing a submitted, pending request.
2. The same request, approved, on the Stock Adjustments page.

#### Transfers & Adjustments

**What the proposal describes:** Stock moves between warehouses, or correction adjustments, never post silently — both require a manager's approval and a reason code, both audited.

**How the prototype demonstrates it:** Branch → **Stock Transfers** (`/branch/stock-transfers`) and **Stock Adjustments** (`/branch/stock-adjustments`) both implement request → approve/reject. A transfer only moves stock (decrementing the source, creating or incrementing the destination) once approved; an adjustment requires a reason code (Damage / Shrinkage / Count Correction / Other) and only changes the balance once approved.

**📸 Screenshot(s) needed:**
1. Stock Transfers page with a pending request.
2. Stock Adjustments page showing the reason-code dropdown on the request form.

#### Physical / Cycle Counts

**What the proposal describes:** A guided count sheet, automatic variance calculation, and any variance over a defined threshold routed to a supervisor for review before it posts.

**How the prototype demonstrates it:** Branch → **Stock Count** (`/branch/stock-count`) generates a count sheet for every SKU/lot with a blank counted-quantity field. On submission, each line's variance is checked against a threshold (±5%, minimum 2 units); if every line is within tolerance the count auto-posts and closes immediately, but if any single line exceeds it, the entire count is held as "Pending Approval" with an "Approve & Post Adjustment" action.

**📸 Screenshot(s) needed:**
1. Stock Count sheet with counted-quantity fields filled in.
2. A count sitting in Pending Approval, showing its variance table.
3. A small-variance count that auto-closed without needing approval.

#### Good vs. Bad Stock

**What the proposal describes:** Two separate buckets — sellable and damaged/expired — per SKU/location; reclassifying between them (in either direction) is itself a logged transaction.

**How the prototype demonstrates it:** Every stock row tracks Qty Good and Qty Damaged separately. The Warehouse Stock page has "To Bad" and "To Good" controls on each row; both directions create a logged event (quantity, direction, reason, who, when) rather than silently changing the two counters.

**📸 Screenshot(s) needed:**
1. Warehouse Stock page's "To Bad" / "To Good" controls on a row that has both good and damaged quantity.

#### Near-Expiry & FEFO

**What the proposal describes:** Near-expiry stock flagged on inventory screens; FEFO logic suggests which batch to pick to fulfil an order.

**How the prototype demonstrates it:** Branch → **Near-Expiry Alerts** (`/branch/near-expiry`) is a dedicated list of lots within an expiry window; the Warehouse Stock page also badges any lot within 30 days as "Near Expiry" or "Expired." FEFO picking itself is shown on Branch → **Van Loading** (`/branch/van-loading`), where stock is sorted soonest-expiry-first with the top expiring lots badged "Pick First," and on a DMS backend order's Picklist (Section 3.3.1), where the earliest-expiring lot with enough available stock is reserved automatically for each line.

**📸 Screenshot(s) needed:**
1. Near-Expiry Alerts page.
2. Van Loading page's "Pick First" badges.
3. A backend order's picklist showing the FEFO-reserved lot per line.

### 3.2.3 Ready Stock Delivery / Van Inventory

#### Replenishment Approval

**What the proposal describes:** A rep's stock request or a planned driver load is reviewed and approved by a warehouse supervisor before anything is picked.

**How the prototype demonstrates it:** Branch → **Replenishment Requests** (`/branch/replenishment-requests`) approves or rejects a rep-submitted stock request from the SFA app, then marks it fulfilled once loaded. Branch → **Van Loading** requires the same kind of approval for a branch-initiated load (see below), so both request paths described in the proposal go through a control point.

**📸 Screenshot(s) needed:**
1. Replenishment Requests page with a pending request and its Approve/Reject controls.

#### Warehouse-to-Van Loading

**What the proposal describes:** Once approved, requested stock moves out of warehouse inventory into the van's inventory as its own distinct transfer — the same mechanism as a warehouse-to-warehouse move, just targeting a van.

**How the prototype demonstrates it:** Branch → **Van Loading** (`/branch/van-loading`) works as request → approve, mirroring Stock Transfers: submitting a load reserves the requested quantities (shown as "(N reserved)" against the available quantity) without moving stock yet; approval on the same page is what actually decrements the warehouse balance and creates or increments the van's stock row.

**📸 Screenshot(s) needed:**
1. Van Loading page's Pending Approval section with a requested load.
2. The same load after Approve, with the reserved-quantity annotation shown beforehand for contrast.

#### Live Van Balances

**What the proposal describes:** Each van's stock is tracked in real time as sales, collections and returns are recorded through the SFA app.

**How the prototype demonstrates it:** SFA → **Van Stock** (`/sfa/van-stock`) reads the same stock-balance rows the warehouse side writes to. Every SFA order decrements van stock the instant it is placed, so a branch or supervisor user sees the same up-to-the-minute van position without waiting for the driver to return.

**📸 Screenshot(s) needed:**
1. SFA Van Stock page showing current quantities per SKU.

#### Van-to-Warehouse Returns

**What the proposal describes:** Unsold or damaged van stock is returned either into sellable warehouse stock or the damaged bucket.

**How the prototype demonstrates it:** Branch → **Van Returns** (`/branch/van-returns`) — a "Good" condition return adds back into warehouse Qty Good; "Damaged" adds into Qty Damaged, both preserving the original lot number.

**📸 Screenshot(s) needed:**
1. Van Returns form with the Good/Damaged condition selector.
2. The returns history table showing one Good and one Damaged entry.

#### End-of-Day Reconciliation

**What the proposal describes:** Loaded, sold and returned quantities reconciled automatically against actual van stock at day's end; mismatches flagged for investigation; the same reconciliation visible from both warehouse and field.

**How the prototype demonstrates it:** Branch → **End-of-Day Reconciliation** (`/branch/eod-reconciliation`) computes `expected = loaded − sold − returned` per SKU and compares it to the van's actual current stock, flagging any mismatch. The field-side counterpart, SFA → **End-of-Day** (`/sfa/eod`), runs the identical computation and includes a rep-facing "Confirm Reconciliation" action — the rep's sign-off is timestamped, and confirming with an unresolved mismatch raises a flag for investigation rather than letting it pass silently.

**📸 Screenshot(s) needed:**
1. Branch EOD Reconciliation page showing at least one Match and one Mismatch row.
2. SFA End-of-Day page with the same figures and the Confirm Reconciliation button.

---

## 3.3 Visibility & Capabilities — Sales & Finance Supervisors

**Role to select:** Sales & Finance Supervisor

### 3.3.1 Sales & Order Processing

#### Order Intake

**What the proposal describes:** Field orders (SFA) and backend orders (phone/walk-in, entered by branch staff) land in the same order-processing queue, through the identical validation and fulfilment path.

**How the prototype demonstrates it:** Supervisor → **Orders** (`/supervisor/orders`) lists every order regardless of origin. Field orders arrive from the SFA app; backend orders are entered directly through **New Backend Order** (`/supervisor/orders/new`), which runs the identical pricing, promotion, credit and stock validation as the SFA path.

**📸 Screenshot(s) needed:**
1. Orders list showing both an SFA-sourced order and a backend order together (the "Rep" column distinguishes a field rep's name from a supervisor's name).
2. New Backend Order entry form.

#### Order Validation

**What the proposal describes:** A single-pass validation checks customer status, price/promotion, credit limit against outstanding balance, and stock availability. Any failure routes to the supervisor as a deliberate exception, never silently blocked or silently allowed.

**How the prototype demonstrates it:** Both the SFA and backend order paths check the outlet/branch's active status (inactive blocks the order), apply pricing/promotions, compare outstanding AR to the credit limit (an over-limit order becomes a pending "Credit Limit Exception" and is held), and — on the backend path — check warehouse stock availability (insufficient stock becomes a "Stock Shortage" exception). Approving either exception on **Approvals** is what actually releases the held order into fulfilment, rather than leaving it stuck.

**📸 Screenshot(s) needed:**
1. Approvals page with a pending Credit Limit Exception, showing the order and the amount over limit.
2. The same order's status shown before approval (Draft/held) and after (Confirmed or Delivered).

#### Allocation & Picking

**What the proposal describes:** An accepted order reserves stock so it can't be sold twice, and a picklist is generated referencing FEFO batch suggestions.

**How the prototype demonstrates it:** A confirmed backend order reserves the FEFO-earliest lot with enough available stock for each line, and its order detail page displays this as a "Picklist (FEFO-reserved lots)" table before fulfilment.

**📸 Screenshot(s) needed:**
1. Backend order detail page's Picklist table, with the Reserved Lot column visible.

#### Invoicing & Delivery

**What the proposal describes:** A formal invoice is generated on confirmation; delivery is recorded against the customer's digital signature. Partial delivery is fully supported — the quantity actually delivered is recorded as delivered, and the shortfall is tracked rather than treated as fully delivered.

**How the prototype demonstrates it:** SFA orders capture a signature on-device and invoice/deliver instantly (van-sale model). A backend order instead has a **"Record Delivery"** step on its detail page — a supervisor enters the actual delivered quantity per line, which can be less than ordered; the invoice is generated only for what was actually delivered, stock is decremented by the delivered amount, and the delivery is marked "Partial" whenever any line falls short.

**📸 Screenshot(s) needed:**
1. SFA order screen showing the signature capture.
2. Record Delivery form on a backend order, with a delivered quantity entered lower than ordered.
3. The resulting invoice and the delivery's "Partial" status badge.

#### Cancellation & Void

**What the proposal describes:** Once locked, correcting an order means an approved void — stock allocation and financial posting reversed, reason logged, original stays visible marked voided.

**How the prototype demonstrates it:** An invoiced or delivered order shows a "Request Void" control requiring a reason; approving it on Approvals flips both the order and its invoice to "Voided" and posts a reversing AR ledger entry, while the original rows remain visible with their updated status.

**📸 Screenshot(s) needed:**
1. Request Void form on an order.
2. The order and invoice both showing "Voided" after approval.

### 3.3.2 Promotions, Discounts & Claims

#### Discount Exception Approval

*(Same mechanism as Section 3.1.2 "Discount Override Control" — this is the supervisor's view of that same approval queue.)*

**📸 Screenshot(s) needed:**
1. Approvals page filtered to a Discount Override entry, showing the requested discount, reason, and order.

#### Claims Workflow

**What the proposal describes:** A promotional cost claim moves through submission → review → approval → settlement, with status visible at every stage and a full decision history retained.

**How the prototype demonstrates it:** Supervisor → **Claims Review** (`/supervisor/claims`) lists every claim with its current lifecycle status. Each claim's detail page enforces the exact transition sequence (submitted → reviewed → approved → settled, or rejected at any point) and shows a timeline of every status change with who made it, when, and why.

**📸 Screenshot(s) needed:**
1. Claims Review list, ideally showing claims at a few different lifecycle stages.
2. A single claim's detail page with its full status-history timeline.

### 3.3.3 Finance & Accounts Receivable

#### AR Ledger

**What the proposal describes:** A running per-customer receivables balance, built automatically from invoices issued and payments received.

**How the prototype demonstrates it:** Every invoice posts an "invoice" ledger entry and every payment posts a "payment" ledger entry, each carrying a running balance; the Payment Reconciliation and AR Aging screens both read this ledger live.

**📸 Screenshot(s) needed:**
1. An outlet's ledger entries — visible via the "Recent Payments & Credit Notes" list on the Payment Reconciliation page.

#### Ageing

**What the proposal describes:** Outstanding invoices grouped into ageing buckets (current, 30, 60, 90+ days).

**How the prototype demonstrates it:** Supervisor → **AR Aging** (`/supervisor/ar-aging`) buckets every outstanding invoice into Current, 1–30, 31–60, 61–90, and 90+ days, with per-outlet totals and a credit-limit column that highlights any outlet currently over their limit.

**📸 Screenshot(s) needed:**
1. AR Aging page showing all five bucket columns, ideally with one outlet flagged over its credit limit.

#### Payment Reconciliation

**What the proposal describes:** A payment is matched to the specific invoice(s) it settles, automatically where clear, manually where judgment is needed.

**How the prototype demonstrates it:** A field collection auto-applies oldest-invoice-first; Supervisor → **Payment Reconciliation** (`/supervisor/payment-reconciliation`) lets a supervisor manually select specific invoices and split a lump-sum payment across them — both paths post to the same AR ledger.

**📸 Screenshot(s) needed:**
1. Payment Reconciliation page with specific invoices checked and split amounts entered.

#### Credit Controls

**What the proposal describes:** The same credit limit the order-validation engine checks is visible to supervisors against the customer's current position.

**How the prototype demonstrates it:** The AR Aging page shows the credit limit next to each outlet's total outstanding (see Ageing above); the SFA outlet detail screen shows the same two figures for the rep's own reference.

**📸 Screenshot(s) needed:**
1. SFA outlet detail screen's Credit Limit / Outstanding AR panel.

#### Financial Document Workflows

**What the proposal describes:** Reversing a posted payment or credit note requires supervisor approval and is captured in the full audit history — never a quiet edit.

**How the prototype demonstrates it:** The Payment Reconciliation page's ledger list has a "Request Reversal" action per entry; approving it on Approvals posts an offsetting ledger entry and, for a reversed payment, rolls the invoice status back — with the whole action recorded in the Audit Log.

**📸 Screenshot(s) needed:**
1. "Request Reversal" control on a posted payment.
2. The resulting reversal entry in the ledger, and its record in the Audit Log.

### 3.3.4 Team Performance & Coverage Monitoring

#### Team Dashboard

**What the proposal describes:** One view of the team's visits, orders, and collections for the day.

**How the prototype demonstrates it:** Supervisor → **Team Dashboard** (`/supervisor/team-dashboard`) rolls up the branch's reps' daily activity in a single screen.

**📸 Screenshot(s) needed:**
1. Team Dashboard page.

#### Coverage & Call Monitoring

**What the proposal describes:** Planned visits (from the route master) compared against actual GPS check-ins, surfacing any missed outlet.

**How the prototype demonstrates it:** Supervisor → **Coverage Monitoring** (`/supervisor/coverage`) compares each rep's route stops against their check-ins for the day and flags any planned stop with no matching visit.

**📸 Screenshot(s) needed:**
1. Coverage Monitoring page, ideally with at least one missed-outlet flag visible.

#### Individual Scorecards

**What the proposal describes:** Each salesperson's performance summarized against tracked metrics — orders, collections, coverage.

**How the prototype demonstrates it:** Supervisor → **Rep Scorecards** (`/supervisor/scorecards`) lists every rep's 30-day order count/value, visit count, and collections total, each with a detail page carrying the same breakdown.

**📸 Screenshot(s) needed:**
1. Rep Scorecards list.
2. A single rep's scorecard detail page.

---

## 3.4 Visibility & Capabilities — Management & Reporting Users

**Role to select:** Management & Reporting

### 3.4.1 Reporting & Analytics

#### Operational Dashboards

**What the proposal describes:** Standard dashboards spanning customer, route, sales, inventory, purchasing, claims and receivables activity across the whole branch network.

**How the prototype demonstrates it:** Management → **Cross-Branch Dashboard** (`/management`) shows KPI cards (Sales, Collections, Purchases, Warehouse Stock Value, Van Stock Value, Pending Claims, Overdue AR), a Sales-by-Branch chart, a daily sales trend chart, and a per-branch summary table with a drill-through link.

**📸 Screenshot(s) needed:**
1. Management dashboard's KPI row and charts.
2. The per-branch summary table, including its Van Stock column.

#### Export & Scheduling

**What the proposal describes:** Any report exportable to Excel/PDF on demand, or configured to run and deliver automatically on a recurring schedule.

**How the prototype demonstrates it:** "Export CSV" (a client-side download, standing in for Excel export) and "Print / Save as PDF" (browser print with a stylesheet that hides all navigation chrome) buttons appear on both the Management dashboard and its branch drill-down page. Recurring scheduling is configured on Admin → Scheduled Reports (Section 3.1.4).

**📸 Screenshot(s) needed:**
1. Export CSV / Print buttons on the Management dashboard.
2. The resulting print preview, with the sidebar and controls hidden.

#### Drill-Down

**What the proposal describes:** From any summary figure, click through to the underlying transactions that make it up.

**How the prototype demonstrates it:** Management → **Branch Drilldown** (`/management/branch/[id]`), reached via "View Transactions" from the dashboard's per-branch row, shows the branch's recent Sales Orders, Invoices, and Claims, with Salesperson / Route / Customer / Date filter controls on the orders table — tracing a branch total down to the individual orders behind it.

**📸 Screenshot(s) needed:**
1. Branch Drilldown page with the filter controls and the underlying orders list.

#### BI Feed

*(Same governed feed described in Section 3.1.4 — Management's dashboards are fed by it.)*

**📸 Screenshot(s) needed:**
1. Management dashboard's "Last exported to BI" line (same capture as referenced in 3.1.4, can be reused).

---

*Document generated to support the Company F and B DMS solution walkthrough. All "simulated" or "stubbed" items noted above are intentional prototype scope, matching the original brief's instruction not to build real ERP/payment/offline-sync integrations, and are clearly labeled as such within the application itself.*

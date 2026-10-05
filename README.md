# Company F and B — DMS & SFA Prototype

A clickable prototype of a Distributor Management System (DMS) and Sales Force
Automation (SFA) platform for an FMCG company running a **self-distribution**
model (its own branches act as "distributors" — purchasing, warehousing, van
sales and field execution).

This is a demo/prototype, not production software. Data lives in a local
SQLite file and everything external (ERP, payment gateways, cloud infra,
offline sync) is stubbed or simulated.

## Getting Started

```bash
npm install
npm run seed
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). You'll land on the
Central Administrator dashboard by default.

`npm run seed` resets the SQLite database (`prisma/dev.db`) and repopulates it
with a deterministic set of demo data: 3 branches, ~30 outlets across 3
channels, 25 SKUs, sales staff per branch, 30 days of orders/invoices/payments,
near-expiry stock, a pending claim, and a pending credit-limit exception. Run
it again any time to reset the demo to a clean state.

## The Role Switcher

There is no login. A **role switcher** in the header (desktop) or top bar
(mobile/SFA view) lets you jump between the five personas instantly:

1. **Central Administrator** — master data, pricing, promotions, audit log (all branches)
2. **Branch / Warehouse Operations** — purchasing, receiving, warehouse & van stock (one branch)
3. **Sales & Finance Supervisor** — approvals, claims, AR aging, team dashboard (one branch)
4. **Field Sales Representative** — mobile-style SFA app: orders, van stock, collections, visits
5. **Management & Reporting** — cross-branch dashboards, drill-down (read-only, all branches)

Switching role also lets you pick a **branch** (for branch-scoped roles) and a
**user** (the staff member whose name is attributed to actions you take, e.g.
who submitted a claim or approved a request). Selections are stored in cookies
so they persist across page loads.

The Field Sales Representative screens render inside a fixed-width mobile
frame with a bottom tab bar, even in a desktop browser, to simulate the phone
app experience.

## What's Real vs. Stubbed

**Real (within the prototype):**
- All data lives in and is read from a real SQLite database via Prisma.
- CRUD forms for branches, outlets, products, pricing rules and promotions
  persist to the database.
- The approval, claims-review, order-capture, collection, van-loading,
  goods-receipt and stock-count workflows all read and write real rows —
  submitting an order actually creates a `SalesOrder`, deducts van stock,
  raises an `Invoice`, and posts an `ARLedgerEntry`, etc.
- Credit-limit checking on order submission is simulated by comparing the
  outlet's live outstanding AR balance against its credit limit; orders that
  exceed it are put on hold and routed to the Supervisor's approval queue.

**Stubbed / simulated:**
- **Authentication** — the role switcher replaces login entirely.
- **ERP / merchandising / trade-promo / BI integrations** — shown only as a
  static "Last synced: …" indicator on the Management dashboard.
- **GPS** — field visit check-in uses the outlet's stored coordinates instead
  of a real device location.
- **Photo upload** — a placeholder tap-target; no file is actually stored.
- **Payment processing** — collections just record a ledger entry; no real
  payment rail is involved.
- **Offline / sync** — the SFA screens are ordinary server-rendered web pages,
  not an installable offline-capable mobile app.

## Tech Stack

- Next.js 16 (App Router) + TypeScript (strict)
- Tailwind CSS v4
- Prisma 6 + SQLite (`prisma/schema.prisma`, `prisma/seed.ts`)
- Recharts for the Management dashboard charts
- No client-side state library — mutations go through Next.js Server Actions
  (`app/actions/*.ts`)

### Design System

Colors and typography are sourced from the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
skill (vendored under `.claude/skills/`, excluded from ESLint):

- **Palette:** "CRM & Client Management" profile — blue-600 primary (`#2563EB`)
  + emerald-600 accent (`#059669`) on a slate background, chosen for a
  trust-oriented enterprise feel that matches the emerald/amber/rose status
  badges already used throughout.
- **Typography:** "Corporate Trust" pairing — Lexend for headings, Source
  Sans 3 for body text — chosen for enterprise/accessibility-focused products.
- **Style:** Flat Design — matches the dashboard/SaaS/corporate use case,
  no gradients or heavy shadows, icon-heavy via `lucide-react`.

## Project Structure

```
app/
  (admin)/        Central Administrator screens
  (branch)/       Branch / Warehouse Operations screens
  (supervisor)/   Sales & Finance Supervisor screens
  (sfa)/          Field Sales Representative screens (mobile shell)
  (management)/   Management & Reporting screens
  actions/        Server Actions used by the above (session, admin, branch, supervisor, sfa)
components/       Shared UI (AppShell, Sidebar, MobileShell, RoleSwitcher, KpiCard, charts, ...)
lib/              Prisma client, session helpers, formatting, constants
prisma/           schema.prisma and seed.ts
```

## Resetting the Demo

```bash
npm run seed
```

This drops and recreates all rows (not the schema) using a deterministic
pseudo-random generator, so every reseed produces the same realistic dataset —
useful if a demo session leaves the data in a confusing state.

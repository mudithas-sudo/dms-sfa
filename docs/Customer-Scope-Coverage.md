# Coverage of the customer scope documents

Validated against the three documents supplied by Company F and B: the DMS BRD, the SFA BRD and the vendor RFP.
Legend: ✅ in the prototype · ⚪ cannot be shown in a prototype (hosting, scale, live connections).

## Items added after the first gap review

| Scope item | Status | Where to see it |
|---|---|---|
| Create a purchase order, and receive purchase orders from the ERP | ✅ | Branch → Purchase Orders → *New purchase order* / *Receive ERP purchase orders*. An ERP order with an unknown SKU lands in the exception queue and the gateway log. |
| Merchandising application: inventory observations in; approved returns, near-expiry signals and suggested order quantities out | ✅ | Admin → Merchandising Interface. Every exchange is written to the gateway log; an outage puts it in the error queue for resend. Shelf observations show on the SFA outlet page and raise a shelf-gap alert to the supervisor. |
| E-invoicing and tax outputs | ✅ | Supervisor → E-Invoicing & Tax (send one or all pending invoices; JSON and XML download per invoice). An invoice to a customer with no TIN is rejected with the reason and can be resent once the TIN is added. Report: *VAT sales book*. |
| Data migration and bulk import with reconciliation | ✅ | Admin → Data Import & Migration. CSV templates for customers, products and price lists. Each file is validated first; nothing is saved until the batch is confirmed. Rejected rows download as a CSV; a reconciliation (file rows = imported + duplicates + rejected) is shown after import. |
| Key-account activities in SFA | ✅ | New *Key Account Manager* role with its own home screen: account list, account page (sales trend, agreed terms, open tasks, activity history), next-action list. Supervisors see the accounts and recent activity under Supervisor → Key Accounts. |
| Maintainable financial reference records | ✅ | Admin → Financial Reference Data: payment terms, banks and tax rates. They feed the customer form, payment and collection forms, invoice VAT and the e-invoice. A payment term that customers use cannot be switched off. |

## Not demonstrable in a prototype

Azure / Azure SQL hosting, uptime, disaster recovery, backup and archive, 250 / 600-user scale testing, optional AI capabilities beyond the rule-based insights panel, and vendor certifications.

## Head-office visibility (central administrator)

The administrator's home page is the control tower: sales against target, receivables and overdue, collections, customer returns, central-warehouse returns, stock value and near-expiry, claims in progress, with a branch-by-branch comparison. A "Needs head-office attention" list puts approvals waiting for head office, credit holds, returns awaiting credit notes, central-warehouse return discrepancies, open claims, change requests, purchase-order exceptions, rejected e-invoices and integration errors first. Each branch opens into its own profile (ageing, largest overdue customers, returns, claims, pending approvals, near-expiry lots). Receivables and returns by branch remain under Reporting → Branch Network View.

## Field app (mobile) and sample data

- The field app fills the phone screen on a real device (phone frame only on larger screens), has a slim header, 44px touch targets and a bottom navigation bar. The order form is four short steps — customer, products, delivery, review & submit — and *Submit order* / *Save as draft* are the last items on the page, not fixed to the screen.
- Head office has its own menu group: Head Office Overview, Receivables — All Branches, Returns — All Branches, Branch Network View.
- Every feature has sample data: branch order flow (confirmed, allocated, picklists, picked, invoiced, out for delivery, delivered, short-delivered with undelivered balances, backorders, held orders), territories, pricing and standing-discount rules, credit/debit notes and write-off awaiting approval, tasks, leave and expenses, change requests, inter-branch transfers, stock adjustments and damage events, opening-balance batches, replenishment, van counts and reconciliations, claim lines, scheduled-report runs, export and duplicate logs, photos, merchandiser observations, import batches.

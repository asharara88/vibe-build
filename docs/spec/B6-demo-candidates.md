> Living specification. Cut unchanged from HANDOVER.md Part B on 11 November 2026. Change only with the owner's agreement, and record the change in docs/DECISIONS.md.

## B6. Demo candidates

Three candidates for the first live demonstration, outside the ten test examples. They are illustrative, and the owner chooses (section 14). D1 and D2 are made up. The domain notes in D3 come from the owner.

**D1. Inspection and compliance tracker, for a safety services company.**

- Raw ask: "We need to track site inspections and what was found, and know when certificates are about to expire."
- Pattern: checklist + status per record, with dated alerts.
- Likely content: sites, inspection types with checklists, findings with a severity and a photo, corrective actions with due dates, certificates with expiry dates. Roles: inspector, supervisor.
- Example of done: an inspector completes an inspection on a phone with two findings and a photo. The supervisor assigns an action with a due date. The site shows as not compliant until the action is closed. A certificate expiring within 30 days appears in the alerts list.

**D2. Delivery and cylinder tracking, for a gas distribution business.**

- Raw ask: "Something to track gas cylinder deliveries, which cylinders are with which customer, and what each driver did today."
- Pattern: records + status + log.
- Likely content: customers, orders, cylinders with serial numbers, deliveries by driver, empties collected. Roles: dispatcher, driver, manager.
- Example of done: a dispatcher creates an order for three cylinders. The driver marks it delivered on a phone and records two empties collected. Cylinder locations update. The manager's daily sheet shows the delivery.

**D3. Finance commission leak report, for a car dealership.**

- Raw ask: "Show me how much finance commission we are losing and where."
- Pattern: dashboard over spreadsheet, with data entry.
- Domain notes (owner, UAE): customers arrange their own car loan. The dealer earns a commission only when the loan is closed by the auto sales channel of a bank on the dealer's panel. The dealer earns nothing when a bank branch closes it, or when the bank is not on the panel. Every financed sale names the bank in the sale paperwork.
- Likely content: an uploaded sheet of sales (date, car, price, salesperson, cash or finance, bank, channel if known); the list of panel banks with their commission terms; commissions received. Roles: finance and insurance manager, general manager.
- Example of done: upload one month of sales and mark the panel banks. The report shows financed sales by bank, the non-panel deals with their estimated lost commission, and the panel-bank deals with no commission received. It filters by salesperson and month. Every number shows its source and period (rule 8). The export shows the filters used (rule 9).

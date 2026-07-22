# Release Notes — NATYAM ERP v2.2.2

**Release:** Final Stabilization
**Date:** 22 July 2026
**Baseline:** v2.2.1
**Type:** Defect fixes + approved changes · three automatic migrations · existing data converted

---

## What changed for the school

**Fees stay the number you typed.** Entering a ₹1,500 monthly fee and saving it
again used to turn it into ₹1,50,000, then ₹15,00,000, and the collection screen
suggested 637500 when 6375 was due. Amounts are now held as plain whole rupees —
no decimals anywhere — so nothing can be multiplied a second time. Your existing
fee plans, invoices, payments, salaries and expenses are converted for you on
first open.

**Deleting a student is on the row.** Each student now shows **View**, **Edit**,
**Archive** and **Delete**. Archive keeps the record for a pupil who might come
back; Delete removes them and their invoices, attendance and certificates
together, and tells you what will go before it does anything.

**Erase everything now empties the app.** Previously the erase worked but the
demonstration data was rebuilt the moment the page reloaded — which is why a
teacher still appeared to hold two batches. After an erase the application is
genuinely empty and stays that way, ready for you to import.

**Sample data to test with.** Included alongside this release:

- `natyam-sample-data.json` — 10 students across 3 batches with parents, 3 staff,
  attendance, fee plans and invoices, and one programme. Load it from
  **Settings → Data → Restore**.
- `sample-students.csv` and `sample-staff.csv` for the importer.

So the cycle you asked for works: erase, import, test, erase again.

**Level / Qualification is your list.** Foundation Level 1 to 8, Intermediate
Certificate, Intermediate Diploma, Advanced Masters, Advanced Theory, Advanced
Practical. One field, one list — the words Foundation, Intermediate and Advanced
are part of each name, not extra boxes to fill. Existing students are moved onto
the matching rung automatically, and you can rename, reorder or add to the list
at any time.

**Fee plans are cut back** to what you use: a name, the monthly fee and notes.
Level, one-off registration fee and costume fee are gone, and **Retire** is
replaced by **Delete**.

**Programmes are open to everyone.** The tick boxes in the cast list were
invisible, and examinations were limited to one level. Any student can now be
selected, whatever their level.

**Finance reads better** — the net position leads, with income, expenditure and
margin beside it and the period stated plainly.

---

## For administrators / IT

- **Three migrations** run automatically (schema 4 → 6): amounts convert from
  scaled paise to whole rupees, and dance grades map onto the new ladder. Each
  record is marked as converted so a re-run cannot double-apply.
- **Erase** now clears browser storage and resets invoice and receipt numbering.
- Future fee frequencies (quarterly, half-yearly, annual, workshop, one-time)
  remain declared internally; only Monthly is offered.

## Quality

| Check | Result |
|---|---|
| Import / cycle checks | pass (59 files, no cycles) |
| Static (css / dead-code) | no new findings vs v2.2.1 |
| Smoke | 31 / 31 |
| Render QA | 50 / 50 |
| Phase 0.5 / 1 / 2 regression | 6 / 6 · 21 / 21 · 40 / 40 |
| Stabilization regression | 62 / 62 |
| v2.2.2 regression | 48 / 48 |
| Navigation QA | 26 / 26 apart from one pre-existing timing flake |

## Known issues

- **Navigation-QA `/settings` flake — pre-existing, unchanged.** Under the test
  harness a deferred render in the Reports module can touch a container that has
  already been torn down; the error surfaces on the next route checked. It has no
  effect on the running application and Reports is outside this release's scope.

## Upgrade

Replace the application files with this package. Data is converted on first open.

# Release Notes — NATYAM ERP v2.2.1

**Release:** Stabilization
**Date:** 22 July 2026
**Baseline:** v2.2.0 (Phase 2)
**Type:** Defect fixes + monthly fee change · two automatic migrations · existing data preserved

---

## What changed for the school

**Managing a student is direct again.** Each row in the student list now has
**View**, **Edit** and **Archive** buttons. Before this, the only way in was to
click a row and then find a second "Actions" button, so the list looked as
though it offered nothing.

**Fees are monthly.** A fee plan now asks for **one monthly figure** instead of a
yearly total and a number of instalments. The plan list shows the monthly fee
with the year's total beside it, and billing raises twelve monthly invoices.
**Existing plans are converted for you** — the yearly figure is divided by twelve
— so nothing needs re-entering.

**The Level / Qualification list matches what was approved:** Foundation Level 1
through Level 8, Intermediate Certificate and Diploma, Advanced Masters, Theory
and Practical. It is one list you pick from, and you can rename, reorder, retire
or add to it from the Curriculum module at any time.

**Adding a student no longer gets stuck.** The form now has a **Branch** field.
Previously, if you did not put the student in a batch, saving failed asking for a
branch that the form never offered. If your school has one branch it is filled in
for you.

**Options you click now look clicked.** Radio buttons — "Change status" on a
student, "Kind" on a finance entry — were invisible and never showed which one
was chosen. They now appear and highlight correctly.

**Creating a batch is clearer.** Days show full names, and **Code** is marked
required, so a save no longer fails pointing at a field nothing had flagged.

---

## Checked and found working

Two reported items turned out to be already correct in this build, and are
covered by new tests so they stay that way:

- **Attendance colours** — Present green, Absent red, Late yellow and Excused
  grey are applied the moment you tap, on both the register and the month grid.
- **Settings editability** — Institute details, branches, fee plans, users and
  preferences are all editable. Dance levels and role permissions stay read-only
  on purpose: they are referenced by existing students, batches and certificates,
  and changing them mid-year would orphan those records.

The admission form's tick controls are switches, which were styled correctly; the
fault reported there was the radio defect, now fixed.

---

## For administrators / IT

- **Two automatic migrations** run on first open (schema 2 → 4). One installs the
  approved Level / Qualification defaults and removes the unused placeholders;
  the other converts fee plans to a monthly amount, keeping the original annual
  figure on the record. No store is reshaped and no records are deleted.
- **Future fee frequencies** (quarterly, half-yearly, annual, workshop, one-time)
  are already declared internally with their cadence, so introducing one later is
  a configuration change rather than a rebuild. Only Monthly is offered now.
- **Offline-first** behaviour is unchanged.

## Quality

| Check | Result |
|---|---|
| Import / cycle checks | pass (59 files, no cycles) |
| Static (css / dead-code) | no new findings vs v2.2.0 |
| Smoke | 31 / 31 |
| Render QA | 50 / 50 |
| Navigation QA | 26 / 26 on 18 of 19 runs (one pre-existing timing flake) |
| Phase 0.5 regression | 6 / 6 |
| Phase 1 regression | 21 / 21 |
| Phase 2 regression | 40 / 40 |
| Stabilization regression | 62 / 62 |

## Known issues

- **Navigation-QA `/settings` timing flake — pre-existing, unchanged.** Under the
  jsdom test harness a deferred render in the Reports module can touch a
  container the harness has already torn down; the error surfaces on the next
  route checked, which is Settings. It fired once in nineteen runs of this build
  and is identical to the behaviour carried since v2.0.0. It has no effect on the
  running application — a real browser never replaces the container mid-render —
  and Reports is outside this release's scope. Recommended for a guard in the
  release that owns Reports.

## Upgrade

Replace the application files with this package. No data steps are required.

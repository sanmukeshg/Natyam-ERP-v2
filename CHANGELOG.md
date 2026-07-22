# Changelog — NATYAM ERP

All notable changes to this project are recorded here. The project follows a
phase-per-release model: each approved phase increments the version and produces
a completion report, a unified diff, and an updated application package.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project aims to follow [Semantic Versioning](https://semver.org/).

---

## [2.2.2] — 2026-07-22 — Final Stabilization

Resolves every item in the manual UAT report. Money moves to whole rupees, the
Level / Qualification ladder is replaced, and "Erase everything" now leaves a
genuinely empty installation. Three automatic migrations run on first open;
existing records are converted, not discarded.

### Fixed
- **Amounts no longer multiply themselves.** A monthly fee of ₹1,500 stayed
  ₹1,500 on the form but was stored scaled, so re-saving turned it into
  ₹1,50,000 and then ₹15,00,000, and the fee-collection screen offered 637500
  where 6375 was due. Amounts are now stored, entered and displayed as the same
  whole number, so there is no factor left to apply twice. Existing amounts are
  converted once on upgrade.
- **Students can be deleted from the list.** View, Edit and Delete sit on each
  row, alongside Archive for a pupil who may return. Deleting also removes that
  student's invoices, payments, attendance, certificates and documents, so
  nothing is left pointing at a record that no longer exists, and the
  confirmation says exactly what will go.
- **"Erase everything" really empties the application.** The erase cleared every
  table, and the next page load rebuilt the entire demonstration dataset —
  which is why staff, batches and registers appeared to survive it. An erase is
  now recorded, the seeder honours it, browser storage is cleared and the
  invoice and receipt counters are reset.
- **Every student can be cast in a programme.** The picker's tick boxes were
  invisible because the control was missing the element the stylesheet draws,
  and examinations were restricted to a single level so most of the roll arrived
  marked ineligible. Programmes are open to the whole school.
- **The "confirm before anything destructive" setting is visible again** — the
  same missing control element.
- **Form attributes are written correctly.** `step`, `inputmode`, `min`, `max`
  and `autocomplete` were being escaped into the markup as literal text, so a
  number field never had its step or keypad hint.

### Changed
- **Level / Qualification is the approved ladder:** Foundation Level 1 to 8,
  Intermediate Certificate, Intermediate Diploma, Advanced Masters, Advanced
  Theory, Advanced Practical. It is one flat, editable list — "Foundation",
  "Intermediate" and "Advanced" are part of each name, not separate fields.
  Existing students, batches, admissions and certificates are mapped onto the
  equivalent rung.
- **Fee plans are simpler.** Level, one-off registration fee and costume fee are
  gone. "Retire" is replaced by **Delete**, which removes the plan outright and
  unlinks any student still pointing at it.
- **The finance summary leads with the net position**, with income, expenditure
  and margin beside it and the period stated, instead of four competing cards.

### Added
- Sample data for testing: a full dataset (10 students across 3 batches, 3
  staff, attendance, fee plans and invoices, one programme) that loads through
  Settings → Data → Restore, plus student and staff CSVs for the importer.
- `tools/v222-check.mjs` — 48 assertions covering every issue above.

### Database / schema
- Schema version `4 → 6`. One migration converts stored amounts from scaled
  paise to whole rupees (marked per record so it cannot run twice), one maps the
  old dance grades onto the new ladder. Both are additive; no store is reshaped.

## [2.2.1] — 2026-07-22 — Stabilization Release

Fixes eight defects found in manual acceptance testing of v2.2.0 and replaces
the yearly fee model with monthly collection. No feature work. Two additive
schema migrations run automatically; existing records are preserved.

### Fixed
- **Student records can be managed from the list again.** View, Edit and
  Archive (or Restore) now sit on each row. Previously every action was behind a
  row click followed by a second "Actions" button, so the list appeared to offer
  no way to manage a student.
- **Radio buttons are visible and show what is selected.** The control emitted a
  decorative element carrying only a modifier class, so it had no size, no
  border and — because every checked-state rule targets the base class — no way
  to show a selection. Affects "Change status" on a student and "Kind" on a
  finance entry.
- **A student can be enrolled without first choosing a batch.** Every student
  must belong to a branch, but the form offered no Branch field and only
  inherited one from a batch, so enrolling without a batch failed with an error
  the form gave no way to satisfy. The form now has a required Branch selector,
  defaulted to the branch in view or the only branch.
- **Batch days read correctly and a batch saves first time.** The day labels
  were looked up with the wrong casing, and Code was enforced when saving but
  not marked as required on the form, so a save failed pointing at a field
  nothing had flagged.
- **Selection controls are properly contained.** The visually hidden input
  inside a checkbox, radio or switch had no positioning context and was placed
  against a distant ancestor.

### Changed
- **Fees are collected monthly.** A fee plan now stores what is due each month
  rather than a yearly total split into instalments, and yearly wording has been
  removed from the interface. Existing plans convert automatically by dividing
  the annual figure by twelve; the original figure is kept on the record.
  Frequency is stored on the plan and read from a registry that already declares
  quarterly, half-yearly, annual, workshop and one-time, so a future cadence is a
  configuration change rather than a redesign. Only Monthly is offered today.
- **The Level / Qualification list now carries the approved defaults** —
  Foundation Level 1 to 8, Intermediate Certificate and Diploma, Advanced
  Masters, Theory and Practical. These are a single flat, editable list; the
  prefixes are part of each name, not separate fields. They remain seed values
  only and are fully editable from the Curriculum module.
- Sequence counters are derived from the data actually seeded rather than fixed
  numbers, so invoice and receipt numbering cannot collide.

### Verified, no change required
- **Attendance colours.** Present, Absent, Late and Excused each have a colour
  rule for both the register button and the month grid, the tokens exist, and the
  active state is applied on click without a reload. No defect was reproducible.
- **Admission form controls.** These are switches, which were correctly styled.
  The reported fault matched the radio defect fixed above.
- **Settings editability.** Institute (all ten fields), branches, fee plans,
  users and preferences are all editable, and nothing was locked by Phase 2.
  Dance levels and role capabilities remain read-only by design, as they are
  referenced by existing records.

### Tests
- Added `tools/stabilization-check.mjs` — 62 assertions. Control styling is now
  verified by reading the stylesheet and asserting a rule exists for the class
  each control actually emits, including a reachable checked state. This closes
  the gap that let invisible controls pass a full green test run twice.

### Database / schema
- Schema version `2 → 4`. Migration 3 installs the approved Level / Qualification
  defaults and removes the untouched placeholders. Migration 4 converts fee plans
  to a monthly amount. Both are additive and idempotent; no store is reshaped.

## [2.2.0] — 2026-07-21 — Phase 2: Curriculum & Academic Structure

Adds a Curriculum module — courses of study with a configurable
Level → Stage → Lesson structure — and folds academic-year handling into
Settings. Curriculum is deliberately independent of batches. Backward
compatible: existing data is preserved and one additive schema migration runs
automatically.

### Added
- **Curriculum module** (new *Curriculum* item under Teaching). Create and edit
  curricula with a code, name, description, duration, sort order and
  active/inactive status.
- **Curriculum levels** — a reusable, editable vocabulary seeded with Beginner,
  Intermediate and Advanced. Levels can be renamed, reordered, retired and added
  without any code change.
- **Configurable structure** — each curriculum owns a Level → Stage → Lesson
  tree. Levels are drawn from the vocabulary; stages and lessons are added,
  renamed, reordered and removed in place. The tree is saved atomically on the
  curriculum record.
- **Student ↔ curriculum assignment** — an optional Curriculum field on the
  student form, shown on the student’s Overview. Assignment is independent of the
  batch: a student can follow any curriculum regardless of their class, and
  neither references the other.
- A worked example curriculum (*Kuchipudi Foundation*) is seeded on fresh
  installs and assigned to a slice of students to demonstrate the module.
- `tools/phase2-check.mjs` — 39-assertion Phase 2 regression suite.

### Changed
- **Academic year in Settings.** The standalone *Academic years* management tab
  is removed; a compact **Current academic year** control now lives in the
  *Institute* tab (shows the current year, switches between existing years, and
  can add a year). Past years remain stored for reporting.
- Application version bumped to `2.2.0`.

### Database / schema
- Schema version `1 → 2` (additive). New stores `curricula` and
  `curriculumLevels`; a new `curriculumId` index on `students`. A migration
  seeds the three default curriculum levels for both fresh and upgrading
  installs. No existing store or record is reshaped; no out-of-scope module is
  affected (fees, attendance, certificates, promotions, finance and roles are
  untouched, and reporting continues to derive the academic year from the date).

---

## [2.1.0] — 2026-07-21 — Phase 1 (RC1): Critical UI & Functional Bug Fixes

Six approved bug fixes across attendance, forms, batches, start-up and
notifications. No database, schema, or migration changes. Fully backward
compatible; existing data is untouched.

### Fixed
- **Attendance marking now shows colour.** Present displays green, Absent red,
  Late yellow, and Excused a neutral tone, on both the roll-call buttons and the
  month grid. The register buttons were emitting tone names (`success`,
  `danger`, `warning`, `info`) that did not match the stylesheet's
  (`positive`, `negative`, `caution`, `neutral`), so no colour was ever applied.
- **Selection controls in forms are visible and selectable again.** Checkboxes,
  radio buttons, switches, and checkbox groups (including the batch "Days"
  picker and the admission application's document/experience options) now render
  a visible control and a clear selected state. The markup was missing the
  decorative element the stylesheet styles; the underlying value binding was
  never affected.
- **Batches can be created.** The batch form now has a **Branch** field, so a
  batch is always attached to a branch. Previously the form offered no way to
  set a branch and every save was rejected with "Choose which branch this batch
  runs at." The field defaults to the active or only branch, so single-branch
  schools submit without extra steps, while multiple branches present a required
  choice.
- **Batch day selection is robust.** Selected days save and reload correctly
  when editing, and the scheduling-conflict check no longer risks a runtime
  error against a legacy batch whose days were stored in an older shape.
- **Start-up screen branding.** The loading screen now reads
  "NATYAM – School of Kuchipudi".
- **Notifications no longer overlap the header on phones.** On small screens the
  toast stack is anchored below the sticky header instead of on top of it, and
  is height-bounded. Stacking and spacing are unchanged on desktop and tablet.

### Changed
- Application version bumped to `2.1.0`. (This is app metadata; the IndexedDB
  schema version is unchanged, so no migration runs.)

### Tests
- Added `tools/phase1-check.mjs` — 21 assertions covering all six fixes
  (control markup + accessibility, attendance tone/stylesheet consistency, the
  batch branch field and create path, the day-conflict guard, the start-up text,
  and the mobile toast rule).

---

## [2.0.0] — 2026-07 — V2 baseline + Phase 0.5 (Architecture Preparation)

- Baseline NATYAM ERP V2 application: offline-first PWA, layered
  pages → services → repositories, versioned IndexedDB migrations, capability-
  gated navigation, and three automated suites (smoke, render-QA, navigation-QA).
- **Phase 0.5 — Architecture Preparation** (behaviour-identical, no schema
  change): introduced the reference-data resolution seam in `app.config.js`
  (`curriculum()`, `roleTable()`, `roleCapabilities()`, `roleLabel()`) and a
  boot-time override loader, so later phases can make the curriculum and role
  matrix editable without touching every reader. Added `tools/phase05-check.mjs`.

[2.1.0]: releases/phase-1
[2.0.0]: releases/baseline

# Changelog — NATYAM ERP

All notable changes to this project are recorded here. The project follows a
phase-per-release model: each approved phase increments the version and produces
a completion report, a unified diff, and an updated application package.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project aims to follow [Semantic Versioning](https://semver.org/).

---

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

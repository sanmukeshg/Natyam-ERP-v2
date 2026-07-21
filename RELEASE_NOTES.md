# Release Notes — NATYAM ERP v2.2.0

**Release:** Phase 2 — Curriculum & Academic Structure
**Date:** 21 July 2026
**Baseline:** v2.1.0 (Phase 1)
**Type:** Feature release · one additive schema migration · backward compatible

---

## What's new for the school

**A Curriculum module.** Under *Teaching → Curriculum* you can now set up the
school's courses of study. Each curriculum has a code, name, description,
duration and status, and — most importantly — a structure you build yourself:

> Curriculum → **Levels** → **Stages** → **Lessons**

Levels come from a shared list that starts with **Beginner, Intermediate and
Advanced**, which you can rename, reorder, retire or extend at any time — no
developer needed. Within a curriculum you add stages under a level and lessons
under a stage, and reorder or rename anything in place.

**Assigning students.** The student form now has a **Curriculum** field, and the
assigned curriculum shows on the student's Overview. This is completely separate
from batches: a student can follow any curriculum regardless of which class they
attend. Batches and curricula never depend on each other.

**Academic year, simplified.** The old *Academic years* management screen is
gone. In its place, *Settings → Institute* shows a compact **Current academic
year** control where you set the current year (and add one if needed). Past years
are still kept for reporting.

A ready-made example curriculum (*Kuchipudi Foundation*) appears on new installs
so the module isn't empty on first use.

---

## For administrators / IT

- **One automatic migration.** Opening v2.2.0 adds two new stores
  (`curricula`, `curriculumLevels`) and a `curriculumId` index on students, and
  seeds the three default levels. Nothing existing is changed or removed; the
  upgrade needs no manual steps.
- **Backward compatible.** Existing students, batches, fees, attendance,
  certificates and finance are untouched. Reporting still derives the academic
  year from the date, so historical figures are unaffected.
- **Access.** Curriculum management is available to users who can edit Settings
  (the owner by default); assigning a student to a curriculum uses the existing
  student-edit permission. No roles were changed.
- **Offline-first** behaviour is unchanged.

## Quality

| Check | Result |
|---|---|
| Import / cycle checks | pass (59 files, no cycles) |
| Static (css / dead-code) | no new findings vs v2.1.0 |
| Smoke | 31 / 31 |
| Render QA | 50 / 50 |
| Phase 0.5 regression | 6 / 6 |
| Phase 1 regression | 21 / 21 |
| Phase 2 regression | 39 / 39 |
| Navigation QA | 26 / 26 when the pre-existing `/reports` harness flake doesn't fire (see below) |

## Known issues

- **Navigation-QA `/settings` flake — pre-existing, not introduced here.** Under
  the jsdom test harness a deferred render in the `/reports` module can call into
  a torn-down container and log an error, which the very next route check
  (`/settings`) reports. It is identical on the untouched v2.1.0 baseline, has no
  effect on the running app (a real browser never tears the container down
  mid-render), and lies outside Phase 2's scope. Recommended for a guard in the
  phase that owns Reports. The new `/curriculum` route passes navigation-QA
  consistently.

## Upgrade

Replace the application files with this package. No data steps are required.

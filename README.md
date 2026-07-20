# NATYAM ERP 2.0

School management for NATYAM — School of Kuchipudi. Admissions, students,
households, attendance, batches, timetable, fees, finance, staff, programmes,
certificates, reports, analytics, notifications and settings.

Runs entirely in the browser. No server, no build step, no runtime dependencies.

---

## Deploying to GitHub Pages

1. Push the contents of this folder to a repository.
2. Settings → Pages → deploy from the branch root.
3. Open the published URL.

Nothing needs configuring. Every path is relative, so it works from a project
subpath (`user.github.io/natyam/`) as well as from a domain root. The
`.nojekyll` file is required — without it GitHub's Jekyll processor skips some
files.

To run it locally, any static file server will do:

```
python3 -m http.server 8000
```

Opening `index.html` directly from the filesystem will **not** work: ES modules
are blocked under `file://` by browser security policy.

---

## Where the data lives

**In one browser, on one computer.** There is no server holding a copy.

This is the most important thing for the school to understand. Clearing the
browser's site data deletes the records. A different browser, or a different
machine, is a different empty database.

Two things follow, and both are built in:

- **Take backups.** Settings → Data → *Download a backup*. The footer shows how
  long it has been. The backup is a `.json` file that should live somewhere that
  is not this computer.
- **Ask the browser to keep the data.** Settings → Data → *Ask the browser to
  keep this data* requests persistent storage, which stops the browser
  discarding the database when the device runs low on space.

Restoring replaces everything currently held. It is not a merge — merging sounds
safer and is not, because it quietly produces two copies of every record whose
identifier changed and the school finds out months later. A safety copy of the
current data downloads before anything is overwritten, and a restore that
recognises no data in the file refuses to proceed rather than clearing the
database.

---

## Architecture

```
index.html          Entry point. Applies the theme inline before first paint.
manifest.json       PWA manifest — installable, with shortcuts.
.nojekyll           Required by GitHub Pages.
assets/
  css/              tokens → base → components → shell → modules
  icons/            SVG source plus PNG renders for the manifest
js/
  app.js            Bootstrap: open, seed, hydrate, mount, then maintenance.
  config/           Schema, domain constants, capabilities, navigation.
  core/             db, repository, router, session, event bus.
  data/             Repositories and seed data.
  services/         All business logic. 18 services.
  modules/          One page per screen. 16 pages.
  ui/               table, form, wizard, overlay, chart, toast, icons,
                    palette, shell.
  utils/            date, money, id, dom, csv.
tools/              Static checks and the runtime test suites.
```

**The layering rule, which the codebase holds to without exception:**

- Pages talk only to services. No page imports a repository or touches the
  database. This is checked statically, not left to convention.
- Services own every business rule. A student is enrolled the same way whether
  the request came from the admissions wizard, a CSV import, or a script.
- Repositories only persist. They know about stores and indexes, not about what
  a valid invoice is.

Money is stored as integer paise, never floats. Dates are local `YYYY-MM-DD`
strings, never UTC timestamps, because a register marked at 9pm in Hyderabad
belongs to that day and not the next one. The academic year runs June to May.

Finance is double-entry shaped and deliberately separate from fee collection: a
cleared payment posts an income entry inside the same transaction, and the
ledger is the source of truth for the P&L. Income is never recomputed from
invoices, so the two cannot disagree.

---

## Roles

Five roles — owner, administrator, registrar, teacher, accountant — gate which
screens and actions appear. Settings → Roles shows the full capability matrix.

**These are an operating convention, not a security boundary.** There is no
server to enforce them. Anyone with access to this computer and this browser can
reach the underlying database regardless of the role set here. Roles keep people
out of screens that are not their job; the device login is what protects the
records.

---

## Keyboard

| Key | Action |
|---|---|
| `Ctrl`/`Cmd` + `K` | Command palette — search records, run any action |
| `/` | Same, when not already typing |
| `↑` `↓` | Move through results |
| `Enter` | Open the highlighted result |
| `Esc` | Close the palette or any overlay |

---

## Reports and exports

Fourteen reports, defined as data rather than as screens — adding one means
adding an entry to the catalogue in `reports.service.js`, not building another
page.

Three export routes, and an honest note about why:

- **CSV**, which Excel opens natively and which is trivially correct.
- **SpreadsheetML** (`.xls`), a plain-XML format Excel has read for twenty
  years, generated as text, so column widths and number formats survive.
- **Print to PDF** via the browser's own print pipeline against a real print
  stylesheet.

A genuine `.xlsx` writer or a laid-out PDF would mean vendoring several hundred
kilobytes of library into an offline app that nobody at the school can audit or
update. For a school printing a fee statement the outcome is the same.

---

## Importing existing records

Settings → Data → *Import from a spreadsheet*. Students and staff, from CSV or
JSON.

Every row is validated **before anything is written**, including the branch each
record will belong to. The preview states exactly what will happen, and rows
that cannot be imported come back with the reason attached rather than being
silently skipped. Imported records go through the same service calls as
hand-entered ones, so they get the same admission numbers, audit entries and fee
schedules.

---

## Development and testing

No build step. Edit a file, reload the page.

```
node tools/check-imports.cjs    # every import resolves, every name is exported
node tools/check-cycles.cjs     # no circular imports
node tools/check-css.cjs        # every class used in JS exists in CSS
node tools/check-dead.cjs       # unreferenced exports, duplicated helpers
node tools/check-fields.cjs     # record fields read that are never written

npm install fake-indexeddb jsdom   # test dependencies only
node tools/smoke.mjs            # 31 service tests against a real database
node tools/render-qa.mjs        # 48 DOM tests: every page, control and form
node tools/navigation-qa.mjs    # 25 tests: the real router, driven by the URL
```

The application itself has no dependencies. `fake-indexeddb` and `jsdom` exist
solely so the suites can run outside a browser and are never shipped to users.

**Run all three suites before every release.** Between them they have caught a
backup format defect that would have destroyed a school's database on restore,
four capability strings that silently disabled features for every role, three
screens whose field names disagreed with the records they displayed, and a
routing defect that sent fifteen of sixteen screens to the dashboard. None of
those were visible by reading the code.

`navigation-qa.mjs` earns its place separately from `render-qa.mjs`, and the
distinction matters. The render suite constructs pages directly — `new
StudentsPage().render(container)` — which proves each page works but never asks
the router *which page a URL resolves to*. That gap hid a live outage: a stray
`/:id` pattern matched every top-level path, so every sidebar click changed the
URL, highlighted the right item, logged no error, and rendered the dashboard.
The navigation suite never constructs a page. It sets `window.location.hash` and
asserts the viewport contents actually became the right screen. If you add a
route, add it to `NAVIGATION` and this suite will cover it automatically.

`check-fields.cjs` is a heuristic and reports false positives — computed and
service-decorated fields legitimately appear. It is meant to produce a short
list worth eyeballing, not a verdict.

---

## Known limitations

- **No real-browser test pass.** All three suites run against jsdom, which has no
  layout engine. Logic, wiring, event handling and accessibility structure are
  covered; nothing visual is. Anything depending on measured geometry —
  sticky positioning, scroll containers, print pagination — should be checked by
  eye before the school relies on it.
- **Single device.** There is no sync. Two branches using two laptops keep two
  separate databases; the backup file is the only way to move data between them.
- **No authentication.** See *Roles* above.

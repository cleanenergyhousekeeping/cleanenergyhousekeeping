# Clean Energy Housekeeping Agent Instructions

## Source of truth

Use this GitHub repository as the source of truth:

https://github.com/cleanenergyhousekeeping/cleanenergyhousekeeping

Important paths:
- `/clockin` = frontend shell
- `/apps-script` = backend Google Apps Script

Never guess code. Read the current file before editing.

## Service worker rule

Any change to files used by the installed clock-in shell must bump the cache version in:

`/clockin/service-worker.js`

Change:

`const CACHE_NAME = "ce-clockin-shell-v###";`

to the next version number.

This is required when editing:
- `/clockin/app.js`
- `/clockin/index.html`
- `/clockin/style.css`
- `/clockin/manifest.webmanifest`
- `/clockin/icon.png`
- `/clockin/seed.html`

## PR discipline

Use small focused PRs.

Do not modify time-tracker reconciliation, row matching, queue replay, or payroll/invoice logic unless explicitly requested.

Summaries must list:
- changed files
- changed functions
- whether service worker cache was bumped
- tests/checks run

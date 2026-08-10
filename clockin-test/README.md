# Clock-In Shell TEST Environment

This directory hosts the reusable TEST frontend shell.

Flow:

`/clockin-test/` → TEST Apps Script web app → TEST spreadsheet

## Isolation boundaries

- TEST Apps Script deployment URL only.
- TEST localStorage keys: `ce_shell_test_auth_v1` and `ce_shell_test_queue_v1`.
- TEST service worker scope: `/clockin-test/`.
- TEST cache namespace: `ce-clockin-test-shell-v1`.
- Persistent visible `TEST ENVIRONMENT • TEST DATA ONLY` banner.
- Production `/clockin/` files are not modified by this environment.

## Baseline behavior

The TEST shell loads the current `/clockin/` markup, CSS, and JavaScript as its frontend baseline, then substitutes TEST-specific paths, backend URL, and storage keys before execution. This keeps TEST behavior aligned with the production frontend while isolating data and PWA state.

When the TEST-specific bootstrap/runtime files change, increment the TEST cache version in `clockin-test/service-worker.js`.

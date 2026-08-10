# Clock-In Shell TEST Environment

This directory hosts the reusable TEST frontend shell.

Flow:

`/clockin-test/` → TEST Apps Script web app → TEST spreadsheet

## Isolation boundaries

- TEST Apps Script deployment URL only.
- TEST localStorage keys: `ce_shell_test_auth_v1` and `ce_shell_test_queue_v1`.
- TEST service worker scope: `/clockin-test/`.
- TEST cache namespace: `ce-clockin-test-shell-v4`.
- Persistent visible `TEST ENVIRONMENT • TEST DATA ONLY` banner.
- Production `/clockin/` files are not modified; the existing `/clockin/icon.png` is reused without duplication.
- TEST phone preparation is handled locally at `/clockin-test/seed.html` and authenticates directly against the TEST backend, so it never enters the production `/clockin/seed.html` flow.

## Refreshing the production frontend baseline

The TEST shell keeps static text copies of the production markup, CSS, and JavaScript so browsers can load normal files without runtime source rewriting or dynamic code execution. It references the existing production icon at `/clockin/icon.png` rather than copying the binary asset. When production frontend behavior changes:

1. Copy `clockin/index.html`, `clockin/style.css`, and `clockin/app.js` into `clockin-test/`. Do not copy `clockin/icon.png`.
2. In the TEST copies, restore the TEST title and banner, change asset and service-worker paths from `/clockin/` to `/clockin-test/`, and append the TEST banner styles.
3. In `clockin-test/app.js`, restore the TEST Apps Script URL, `ce_shell_test_auth_v1`, `ce_shell_test_queue_v1`, and `/clockin-test/seed.html` preparation URL.
4. Verify that no production backend URL, production storage key, or absolute `/clockin/` asset/route other than `/clockin/icon.png` remains in runtime TEST files.
5. Increment the cache version in `clockin-test/service-worker.js` and update the cache namespace documented above.

Do not replace TEST-specific `seed.html`; it has its own phone preparation flow.

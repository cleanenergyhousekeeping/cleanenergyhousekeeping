# Clean Energy Housekeeping – Agent Instructions

----------------------------------------
SOURCE OF TRUTH (CRITICAL)
----------------------------------------

Primary source of truth:
https://github.com/cleanenergyhousekeeping/cleanenergyhousekeeping

Paths:
• /clockin → frontend shell (app.js, UI)
• /apps-script → backend Apps Script (.gs files)

Rules:
• NEVER guess code
• ALWAYS read current GitHub file before editing
• ALL edits must match existing structure exactly

----------------------------------------
BACKUP REMINDER RULE (PRE-CHANGE)
----------------------------------------

Before making code changes, remind the user to create a Git backup tag.

Suggest a tag name using this format:
backup-pre-[feature-name]-YYYY-MM-DD-HHMM

Wait for the user to confirm that the backup tag was created, or that they explicitly want to proceed without a backup, before editing code.

----------------------------------------
SERVICE WORKER RULE (MANDATORY)
----------------------------------------

Any change to frontend shell files MUST bump cache version in:

/clockin/service-worker.js

Update:
const CACHE_NAME = "ce-clockin-shell-v###";

Increment by +1

Applies to changes in:
• app.js
• index.html
• style.css
• manifest.webmanifest
• seed.html
• icon.png

Failure to do this = stale app in production

----------------------------------------
CODE STYLE (REQUIRED)
----------------------------------------

Follow modular architecture:

• One function = one responsibility

Separate:
• data retrieval
• processing
• formatting
• output

----------------------------------------
COMMENTING STANDARD
----------------------------------------

Use section markers:

/* begin[feature_name] */
...
/* end[feature_name] */

Rules:
• Always include both begin and end
• Never leave mismatched markers
• When editing a section → replace entire section

----------------------------------------
DO NOT MODIFY (HIGH RISK)
----------------------------------------

Unless explicitly instructed, DO NOT change:

• Time tracker reconciliation logic
• Queue replay / sync logic
• Row matching logic
• Payroll calculation logic
• Invoice calculation logic

----------------------------------------
PR RULES
----------------------------------------

All changes must go through PR

PR must include:
• files changed
• functions changed
• whether service worker was bumped
• confirmation of no changes to protected logic
• MUST bump service worker when frontend changes are made

Codex workflow:
• Create a new branch for every code change.
• Make the requested changes only on that branch.
• Open a pull request.
• STOP after opening the PR.
• Do NOT merge the PR.
• Do NOT deploy.
• Do NOT push directly to main.

----------------------------------------
DEBUGGING SUPPORT
----------------------------------------

Use existing logging system:

logClockInDebug_()

Do NOT:
• log sensitive data (PIN, wifi, codes)
• block app execution on logging failure

----------------------------------------
GENERAL PRINCIPLES
----------------------------------------

• Prefer small, focused changes
• Avoid large rewrites
• Preserve existing behavior unless instructed
• Stability > cleverness

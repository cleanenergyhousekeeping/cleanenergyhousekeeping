# Clean Energy Housekeeping – Agent Instructions

----------------------------------------
SOURCE OF TRUTH (CRITICAL)
----------------------------------------

Primary source of truth:
https://github.com/cleanenergyhousekeeping/cleanenergyhousekeeping

Paths:
- /clockin → Live frontend shell
- /clockin-test → TEST frontend shell
- /relay → Cloudflare relay
- /apps-script → backend Apps Script (.gs files)
- /apps-script/99_ProjectSummary.gs → current architecture/status
- /apps-script/100_ToDoList.gs → plans, bugs, decisions, unfinished work

Local repo copy:
~/Documents/Clean\ Energy\ Housekeeping/GITHUB/cleanenergyhousekeeping

Rules:
- GitHub main is the source of truth.
- Use the local repo for testing, syncing, pulling, pushing, deploying, or running commands.
- Before local work, confirm branch, git status, and upstream state; never assume local files are current.
- NEVER guess code
- ALWAYS inspect current GitHub source before recommending or making code changes.
- Do not substitute old chat context, summaries, pasted code, or ChatGPT Sources for current GitHub files.
- ALL edits must match existing structure exactly

----------------------------------------
BACKUP REMINDER RULE (PRE-CHANGE)
----------------------------------------

Before making code changes, ask the user whether to create a Git backup branch from current main.

Suggest a backup branch name using this format:

backup-pre-[feature-name]-YYYY-MM-DD-HHMM

If the user provides a backup branch name, use that exact name.

Create the backup branch from the current main branch before creating the feature branch.

After the backup branch is created, create a separate feature branch for the requested code change.

Wait for the user to confirm the backup branch name, or that they explicitly want to proceed without a backup branch, before editing code.

Do NOT use backup tags unless the user specifically asks for a tag.

----------------------------------------
PROJECT MEMORY (MANDATORY)
----------------------------------------

Before every task, review apps-script/100_ToDoList.gs for related prior decisions,
bugs, constraints, and unfinished work. Inspect the relevant current code, and
read apps-script/99_ProjectSummary.gs when architecture/current behavior matters.
Use Git history or PRs when needed to understand why a design exists.

- Current code defines what exists; the to-do list preserves intended/future context.
- 99_ProjectSummary.gs describes the system that exists now, not the backlog.
  Update it after major completed features or material architecture/behavior changes.
- 100_ToDoList.gs holds plans, bugs, deferred polish, known limitations, unresolved
  questions, agreed but unimplemented decisions, and partially completed work.
- Remind Kyle to update the to-do list at meaningful planning, completion, status
  changes, or stopping points, and when a useful future issue is discovered.
  When practical, include useful updates in the existing task PR; avoid busywork.

----------------------------------------
LIVE / TEST SEPARATION
----------------------------------------

- Live and TEST are separate and may intentionally differ. Never synchronize
  them merely for neatness or refactor stable Live behavior to reduce duplication.
- Keep frontend versions, service workers, Apps Script/clasp targets, deployments,
  Workers, D1 databases, credentials, storage namespaces, and spreadsheets/config
  in their matching environment. Never use Live resources for TEST or vice versa.
- TEST is the default laboratory for new/risky features. Production changes
  require separate production review.

----------------------------------------
SERVICE WORKER RULE (MANDATORY)
----------------------------------------

Any change to frontend shell files MUST bump cache version in:

- Live: /clockin/service-worker.js
- TEST: /clockin-test/service-worker.js

Inspect the affected environment's current version scheme and increment its
cache version; keep any corresponding frontend build version aligned. Do not
bump the other environment unless its frontend also changes.

Applies to changes in:
- app.js
- index.html
- style.css
- manifest.webmanifest
- seed.html
- icon.png

Failure to do this = stale app in production

----------------------------------------
CODE STYLE (REQUIRED)
----------------------------------------

Follow modular architecture:

- One function = one responsibility

Separate:
- data retrieval
- processing
- formatting
- output

----------------------------------------
COMMENTING STANDARD
----------------------------------------

Use section markers:

/* begin[feature_name] */
...
/* end[feature_name] */

Rules:
- Always include both begin and end
- Never leave mismatched markers
- When editing a section → replace entire section
- Never duplicate begin/end markers for the same section

----------------------------------------
DO NOT MODIFY (HIGH RISK)
----------------------------------------

Unless explicitly instructed, DO NOT change:

- Time tracker reconciliation logic
- Queue replay / sync logic
- Row matching logic
- Payroll calculation logic
- Invoice calculation logic

----------------------------------------
PR RULES
----------------------------------------

Prefer PRs: one PR = one clear purpose. Manual edits are fallback only for very
small/urgent changes or when GitHub/Codex is unavailable.

PR must include:
- files changed
- functions changed
- whether service worker was bumped
- confirmation of no changes to protected logic
- MUST bump service worker when frontend changes are made

Codex workflow:
- Create a new branch for every code change
- Start from current GitHub main and make the smallest requested change
- Run relevant tests/checks before opening the PR
- Open a pull request
- STOP after opening the PR; Kyle says “PR ready” for Raven to review the actual diff
- Address review findings on the same branch and request re-review after changes
- Do NOT merge the PR
- Do NOT deploy
- Do NOT push directly to main

----------------------------------------
DEBUGGING SUPPORT
----------------------------------------

Use existing logging system:

logClockInDebug_()

Do NOT:
- log sensitive data (PIN, wifi, codes)
- block app execution on logging failure

----------------------------------------
SCOPE AND EFFICIENCY — NO CARROTS 🥕🚫
----------------------------------------

- Before expanding scope, ask: is this necessary to complete or safely validate
  the requested task? If not, report it, record it in 100_ToDoList.gs when useful,
  and continue the original task unless Kyle authorizes expansion.
- No unrelated fixes, refactors, cosmetic cleanup, broad Live/TEST synchronization,
  or unnecessary infrastructure changes.
- Inspect the smallest relevant code surface first; avoid repeating investigations
  already verified from current source. Prefer read-only investigation before risky
  architecture/security changes. Keep Blue Dude tasks narrow.
- Use lighter models for small edits/routine inspection and stronger models for
  complex debugging, architecture, security, concurrency, or risky production work.
- Suggest a fresh session only when it materially improves reliability/efficiency.
  Explain meaningful scope expansion before doing it.

----------------------------------------
FINAL REPORTING
----------------------------------------

At the end of every response involving code changes, list all edited files under
“Files edited:”. Report relevant validation and any material limitations.

----------------------------------------
GENERAL PRINCIPLES
----------------------------------------

- Prefer small, focused changes
- Avoid large rewrites
- Preserve existing behavior unless instructed
- Stability > cleverness

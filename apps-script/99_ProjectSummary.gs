/**
 * Clean Energy Housekeeping System — Current Architecture Summary
 *
 * VERSION NAME:
 * "Operational System + TEST Durable Relay"
 *
 * UPDATED:
 * 2026-08-23
 *
 * This document describes the system that exists now. It is an architectural
 * summary, not the CEH backlog or a complete project history. The separate CEH
 * to-do list remains the source for pending ideas, bugs, polish, and detailed
 * historical notes.
 *
 * =====================================================
 * 1. OVERALL SYSTEM STATUS
 * =====================================================
 *
 * CEH is an operational housekeeping platform. The Time Tracker is the
 * operational source of truth for completed and open shifts; it feeds Work
 * History, payroll, invoicing, notifications, and related workflows.
 *
 * The cleaner-facing clock-in experience is a mobile-oriented installed web
 * shell. It supports local-first PIN unlock, property lookup and restricted
 * property information, current-shift state, clock-in, cleaning notes, and
 * clock-out. The TEST shell also has a durable relay path for reliable online
 * and offline submission.
 *
 * =====================================================
 * 2. HIGH-LEVEL ARCHITECTURE
 * =====================================================
 *
 * Operational Apps Script system
 *   → Apps Script web application and spreadsheet-bound services
 *   → Time Tracker (shift source of truth)
 *   → Work History, payroll, invoicing, notifications, and property workflows
 *
 * TEST installed clock-in shell
 *   → local prepared-auth and UI state
 *   → local durable relay-event state when relay mode is active
 *   → Cloudflare Worker → D1 relay storage → scheduled delivery
 *   → TEST Apps Script relay service and relay ledger → TEST Time Tracker
 *
 * The relay accepts events durably before Apps Script delivery. A temporarily
 * unavailable spreadsheet service therefore does not discard an accepted field
 * entry.
 *
 * =====================================================
 * 3. ENVIRONMENT SEPARATION AND DEPLOYMENT BOUNDARIES
 * =====================================================
 *
 * - TEST and Live are separate environments. TEST relay Worker/D1 resources,
 *   TEST Apps Script configuration/deployment, TEST shell storage namespaces,
 *   and TEST service-worker scope are isolated from Live.
 * - The TEST frontend is published through GitHub Pages. GitHub/main is the
 *   source of truth for the shipped repository state.
 * - TEST Apps Script clasp configuration is isolated from Live. Do not use a
 *   Live deployment or Live sync target for TEST deployment/synchronization.
 * - Relay keys, tokens, deployment URLs, Apps Script sessions, property data,
 *   and decrypted relay payloads are not source-controlled or logged.
 * - Production relay rollout is not implied by TEST relay implementation.
 *   TEST remains the supported relay environment described here.
 *
 * =====================================================
 * 4. CLEANER CLOCK-IN SHELL
 * =====================================================
 *
 * - The shell is designed for phone use and can be installed as a PWA.
 * - It presents a PIN keypad, cleaner identity, property search, directions,
 *   property information, current-clean state, and clear action feedback.
 * - It supports clock-in, add-note, and clock-out actions. Active-shift rules
 *   lock applicable property/action choices and prevent obvious duplicate or
 *   invalid local actions.
 * - Work History provides a cleaner-facing weekly, shift-level view, including
 *   completed hours and transit information where available.
 * - The shell keeps prepared data and state locally so field operation does not
 *   depend on a network request for every screen transition.
 *
 * =====================================================
 * 5. TEST RELAY ARCHITECTURE
 * =====================================================
 *
 * Event path:
 *   TEST PWA → Cloudflare Worker → encrypted D1 event storage
 *   → scheduled delivery → TEST Apps Script relay service/ledger
 *   → TEST Time Tracker
 *
 * Phone behavior
 * - Each clock-in, note, and clock-out receives a stable event ID, immutable
 *   original submission timestamp, and monotonically increasing per-device
 *   sequence number before it is queued locally.
 * - Events persist locally first and are retried automatically after reconnect.
 *   A queued offline entry retains its original time when reconciled into Time
 *   Tracker.
 * - The phone sends only the first nonaccepted sequence at a time. The Worker
 *   preserves contiguous per-cleaner/device ordering, so missing sequence
 *   numbers block that lane rather than being silently skipped.
 * - A real GET /health probe confirms Worker, environment, and D1 reachability
 *   before relay synchronization. The cleaner-facing relay HUD reports
 *   queued/syncing/reachable/attention states.
 * - Retryable failures retain the event. Non-retryable outcomes create an
 *   attention-required state rather than silently losing the field record.
 * - Web Locks serialize pairing, sequence allocation, and synchronization; an
 *   in-memory guard also prevents concurrent automatic pairing attempts.
 *
 * Worker and Apps Script behavior
 * - Worker acceptance authenticates a paired relay session and writes a
 *   canonical, encrypted event to D1. Idempotent replay of the same event is
 *   acknowledged; conflicts are rejected.
 * - Payloads are encrypted at rest in D1; relay tokens are stored as hashes.
 *   Cleaner/device identity is derived from the relay session, not trusted
 *   event-body fields.
 * - The every-minute Worker delivery process makes fair, sequential attempts
 *   across ready lanes and can drain multiple contiguous events in one run.
 *   It uses leases, backoff, and attention-required retry scheduling.
 * - TEST Apps Script verifies signed Worker requests, validates relay input,
 *   records processing/outcome in the relay ledger, and reconciles events
 *   idempotently into Time Tracker. The ledger supplies contiguous applied
 *   high-water state for the paired device.
 *
 * Automatic TEST installation identity
 * - There is no manual device-ID form. A fresh installation creates an opaque
 *   UUID-based installation ID with no cleaner, PIN, property, or timestamp
 *   identity data and persists it before enrollment.
 * - The same saved ID is reused across retry and lost-response cases. Existing
 *   valid pairing state is authoritative; upgrades never automatically reset
 *   or re-pair an existing installation.
 * - Fresh enrollment requires relay-ledger high-water 0. It initializes the
 *   first event sequence at 1 and fails closed if a fresh ID unexpectedly has
 *   nonzero prior ledger state.
 * - A remaining legacy shell queue blocks relay pairing, avoiding implicit
 *   migration or reordering of prior queued entries.
 * - Reinstalling the PWA or deleting browser storage can legitimately create a
 *   new installation ID and requires a new pairing.
 *
 * =====================================================
 * 6. AUTHENTICATION AND ACCESS CONTROL
 * =====================================================
 *
 * - PIN authentication is local-first in the shell. A prepared installation
 *   can unlock essentially immediately from saved local data.
 * - When online, validation/refresh happens in the background and does not
 *   block normal local unlock. Offline login remains usable for field work.
 * - Appropriate online preparation, unlock, and reconnect paths may refresh
 *   Apps Script auth and recover/renew relay pairing/session state.
 * - The Apps Script system maintains session validation and access control.
 *   FULL versus LIMITED access determines which sensitive property fields are
 *   returned/displayed; restricted entrance/alarm information is not exposed
 *   to LIMITED shell users.
 * - Backend shift rules remain authoritative. They protect against duplicate
 *   clock-ins, invalid clock-outs, wrong-property actions, and invalid notes.
 *
 * =====================================================
 * 7. TIME TRACKING, NOTES, AND WORK HISTORY
 * =====================================================
 *
 * - Time Tracker records cleaner, property/client, clock-in, clock-out, total
 *   hours, and notes. It is the shared operational record used downstream.
 * - The active shift drives current-clean display and property locking in the
 *   UI. Queued relay state is also reflected locally while an accepted event
 *   awaits Apps Script delivery.
 * - Cleaning notes are supported mid-clean and reconcile through the existing
 *   Time Tracker workflow. The current schema still uses established
 *   clock-out-note handling for that workflow.
 * - Work History is derived from completed Time Tracker shifts. Transit
 *   tracking captures between-job time for payroll/operational visibility and
 *   appears in cleaner weekly history when applicable.
 *
 * =====================================================
 * 8. PAYROLL
 * =====================================================
 *
 * Payroll is separated into deliberate spreadsheet steps:
 *
 *   1) Set up payroll sheets and period controls.
 *   2) Populate Payroll Prep from completed Time Tracker shifts.
 *   3) Review/fill pay settings.
 *   4) Generate Payroll Preview.
 *   5) Generate Payroll PDFs.
 *
 * - Payroll Prep is scoped by cleaner and pay period. Cleaner-specific defaults
 *   supply pay rate and daily-minimum values for new prep rows.
 * - Resolution order is: exact Payroll Prep row, cleaner Payroll Defaults,
 *   then global fallback constants.
 * - Preview/PDF calculations support daily minimum guarantees, transit pay,
 *   gas, bonus, and adjustment amounts. PDFs group same-day entries and hide
 *   zero-value optional rows for readable phone-textable output.
 * - Payroll includes a dedicated spreadsheet menu and completed performance
 *   work to keep normal period preparation practical.
 *
 * =====================================================
 * 9. INVOICING
 * =====================================================
 *
 * - Invoice Prep is the intermediate review/control layer between Time Tracker
 *   shifts and generated client invoices.
 * - It groups completed work by service date, client, and property; retains
 *   cleaner details and notes; and supports hourly or flat billing,
 *   property/client rates, discounts, fees, and controlled overrides.
 * - Invoice Control defines invoice number, period, optional rate override,
 *   and optional client filter. Generation produces formatted Docs and records
 *   invoice information through the established invoice workflow.
 * - This separation supports review and legitimate adjustments before invoice
 *   generation instead of treating raw time rows as final billing.
 *
 * =====================================================
 * 10. RELIABILITY, OFFLINE USE, AND PWA UPDATES
 * =====================================================
 *
 * - The installed TEST PWA uses service-worker cache versioning. Frontend
 *   build/cache versions are advanced together when publishing a new shell.
 * - Installed TEST updates have been field-tested across multiple versions.
 *   Force-close then reopen is the reliable current update path.
 * - Foreground-resume update detection/reload is optional polish, not a
 *   required operational update mechanism.
 * - Local storage preserves prepared shell state and relay queue state across
 *   ordinary offline intervals. A queue/retry failure does not itself erase a
 *   shift action.
 *
 * =====================================================
 * 11. IMPORTANT INVARIANTS AND SAFETY RULES
 * =====================================================
 *
 * - Do not bypass Time Tracker as the operational shift record.
 * - Do not reorder, renumber, or drop relay events to unblock a sequence gap.
 * - Preserve original client submission timestamps during offline recovery.
 * - Treat existing valid relay pairing as authoritative; do not auto-reset it
 *   during an app update.
 * - A fresh relay identity with nonzero ledger high-water is fail-closed and
 *   requires attention, not reuse of existing history.
 * - Keep TEST and Live deployment, data, configuration, and credentials apart.
 * - Never place PINs, secrets, tokens, sensitive IDs, or property data in this
 *   summary, Git history, Worker logs, or relay migrations.
 *
 * =====================================================
 * 12. CURRENT KNOWN LIMITATIONS
 * =====================================================
 *
 * - The durable relay path summarized here is TEST-only; production relay use
 *   requires its own explicit rollout and validation.
 * - An attention-required relay event is retained and needs review; the system
 *   will not silently skip it to advance later events.
 * - Force-close/reopen is the dependable installed-PWA update instruction;
 *   automatic foreground-resume updater polish is not a dependency.
 * - Cleaning-note storage follows the existing Time Tracker note workflow; a
 *   separate structured note schema is not represented as completed work.
 *
 * =====================================================
 * 13. NEAR-TERM PRIORITIES
 * =====================================================
 *
 * Maintain and verify the operational and TEST relay paths, resolve
 * attention-required cases without compromising event ordering, and treat any
 * production relay rollout or updater UX refinement as separately scoped work.
 * The CEH to-do list, rather than this summary, holds detailed priorities.
 *
 * =====================================================
 * 14. OVERALL ASSESSMENT
 * =====================================================
 *
 * CEH has a functioning operational time, payroll, and invoicing system with a
 * field-focused cleaner shell. The TEST relay adds a durable, ordered,
 * security-bounded offline delivery architecture without making Apps Script
 * availability a requirement for phone-side event acceptance. The central
 * discipline is to keep Time Tracker authoritative, relay events immutable and
 * ordered, and TEST/Live boundaries explicit.
 */

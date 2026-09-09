	/**
	
	SIRI / APPLE WATCH NOTE CAPTURE — TEST ONLY (updated 2026-09-09)
	
	Current TEST pilot status:
	• TEST-only Siri cleaning-note backend is merged, deployed, and physically validated. PR #87 added durable Siri note intake/reconciliation; PR #88 added the TEST relay signing-ring installer; PR #94 added the active-synced-shift preflight. No Live Siri rollout is authorized.
	• TEST Apps Script was pushed from merged main and the TEST web-app deployment advanced to version 4 for the preflight work. The matching TEST Worker was deployed as ceh-relay-test against ceh-relay-test-db and verified with /health returning environment:test/storage:ok.
	• Kyle's dedicated TEST Siri credential is working. It is note-only, revocable, cleaner-bound server-side, approximately 90-day pilot scope, and cannot clock in/out or read property information.
	• Frozen note POST contract remains exactly four client fields: request_id, captured_at, note_type, note. Shortcut does not send property, cleaner identity, PIN, PWA session, or device identifiers.
	• D1 durable acceptance counts as "saved" for Shortcut cleanup; spreadsheet reconciliation may occur later after a unique completed capture-time interval can be resolved.
	• GET /v1/siri-shift-status is deployed TEST-only and uses the same cleaner-bound Siri credential plus the signed Apps Script boundary. Successful responses expose only active_shift / no_active_shift.
	• Preflight allows dictation only when exactly one valid open synced Time Tracker row exists. Rows with a present Clock Out are excluded before validation; malformed closed history cannot block preflight. Multiple, malformed, future-start, or property-less open rows fail closed. Phone-only queued PWA clock-ins remain invisible until they sync.
	
	Current Shortcut / physical validation:
	• Working Shortcut is now named "Add a Clean Energy Note" for Siri invocation and remains CLEANING NOTE ONLY for the Kyle pilot.
	• The Shortcut says "Checking your Clean Energy shift." before the network preflight so the user gets immediate feedback during the pause.
	• Physical Test A passed: with no active synced TEST shift, Siri says "I can't find an active Clean Energy shift. Please open the Clean Energy app." and stops before dictation/submission.
	• Physical Test B passed: with an active synced TEST shift, dictation/readback continued into the existing POST flow, backend durable success was validated, Siri said "Cleaning note saved", and all four pending files were deleted. After TEST clock-out, the note reconciled through the correct TEST Time Tracker flow.
	• The prior Send/Cancel menu has been removed. After Siri reads the dictated note back, the pilot Shortcut sends automatically. A follow-up smoke test confirmed the menu is gone.
	• During preflight integration, Shortcuts silently rebound downstream blue "Contents of URL" Magic Variables from the note POST to the new preflight GET. The affected post-submit response checks were relinked to POST /v1/siri-notes and the repaired flow then passed Test B. Treat duplicate/moved Get Contents of URL actions as a known Shortcuts-editor hazard.
	• Prefer the Mac Shortcuts app / Blue Dude for future structural Shortcut edits. The iPhone editor is easy to reorder accidentally while scrolling and Magic Variable bindings are difficult to audit there.
	• Existing harmless outer "go" scaffolding from earlier Boolean/If debugging may remain during the Kyle-only pilot; do not risk cosmetic structural surgery unless it becomes operationally necessary.
	• Dictation can clip the first word if Kyle speaks immediately after Siri's prompt. Current workaround: pause briefly before dictating.
	
	Real Shortcut persistence / pilot limits:
	• Real Shortcut persists request_id, captured_at, note_type, and note before POST using four files under Shortcuts/CEH Siri Pending/. Definite validated durable success deletes all four and speaks "Cleaning note saved."
	• Earlier disposable testing proved cross-run persistence of an unchanged request ID/original timestamp/type/note, but the real Shortcut still does not automatically detect/reuse an existing pending request after timeout or unknown outcome.
	• Full exact-retry hardening and a commit/ready marker for the four sequential pending-file writes remain deliberately deferred for the Kyle-only field pilot. Before any crew rollout, retry must preserve the identical request ID/payload after timeout/unknown outcome and safely handle partial four-file state.
	• Temporary TEST diagnostics from PRs #90/#91 remain deployed. Reassess/remove them after the Kyle-only pilot and before any Live/crew rollout. They return only fixed non-sensitive validation reasons and must never expose credentials, note contents, cleaner identity, or property data.
	• Offline caveat remains physical: a PWA clock-in saved only on the phone is invisible to the Siri preflight until the app syncs. Current fail-safe wording intentionally tells the cleaner to open the Clean Energy app.
	
	Kyle field pilot — next step:
	• Use only "Add a Clean Energy Note" in the field for about one week. Reassess usefulness, duplicates, missed notes, dictation clipping, response latency, exact-retry priority, and whether the workflow is actually easier than opening the app.
	• After the field test, decide whether the success speech should include the property name, e.g. "Cleaning note saved for [property]". This would reinforce that the note is tied to a real clean, but it is NOT merely a wording change: the current Siri credential has no property-read authority. Any implementation must explicitly review the smallest safe server-returned display value and preserve the no-broad-property-read boundary.
	• Deep-clean and property-note backend destinations already exist, but do not build/duplicate their real Shortcuts until after the Kyle pilot. If the pilot is useful, build each as a separate small follow-up and physically validate it.
	• Reassess the deferred TEST PWA pre-PIN queued-sync recovery after the pilot. If local queued PWA shift events exist and connectivity is available, syncing them before PIN entry may improve Siri/preflight reliability, but it remains a separate frontend task with its own TEST cache-version bump.
	• No Live Siri promotion, crew rollout, or production credential work until the Kyle pilot is reviewed and explicitly approved.
	
	Post-Kyle-pilot crew onboarding investigation:
	• If Siri proves useful, compare individual Siri credentials against a simplified shared note-only setup with first-run cleaner selection. Do not use/store cleaner PINs as Siri identity.
	• A shared-credential design would reduce onboarding friction but weakens selective revocation and could let a credential holder submit bogus notes or claim another cleaner's User ID. Explicitly review this tradeoff before implementation.
	• If a dynamic cleaner picker is pursued, expose only the minimum safe setup data needed and keep note-only authority unable to clock in/out or read property information.
	
	Siri architecture / security invariants to preserve:
	• Dedicated Siri credential remains separate from PINs and PWA relay credentials; server resolves cleaner identity.
	• Duplicate retry model remains same request ID + same original payload = existing request/outcome; same ID with changed content/time/type = conflict. Timeout is an unknown outcome, not proof of failure.
	• Preserve original captured_at and cleaner identity. Keep request IDs/idempotency state server-side, not visible spreadsheet/property cells.
	• Cleaning note → current clean's existing Time Tracker note path. Existing transitional cleaning-note schema still needs formalization separately.
	• Deep-clean note → append timestamped cleaner/task entry to Deep Clean Items while preserving existing entries.
	• Property note → durable review/email path to Kyle for manual curation; never auto-edit House Notes and never promise exactly-once email when outcome is ambiguous.
	• Normal type-specific completion wording stays short unless later deliberately changed: "Cleaning note saved", "Deep clean note saved", "Property note received". Request IDs stay invisible.
	• If Siri has already durably accepted a note but a phone-only queued shift is still waiting to sync, recovery wording remains: "Note queued. Please open the Clean Energy app now so any saved clock-in can sync."
	
	Agreed TEST PWA relay-recovery polish:
	• When the app is opened/focused, inspect local relay state before PIN entry.
	• If there are NO locally queued PWA relay items, preserve today's fast local-first PIN/unlock behavior with no added network wait.
	• If locally queued relay items DO exist and connectivity is available, sync them before allowing PIN entry. Temporarily disable/freeze the PIN keypad only for the actual queued-sync operation so the cleaner cannot enter the PIN while that recovery sync is in progress.
	• Recovery HUD wording: show "Syncing queued items…" while the pre-PIN relay flush is running, then "All queued items synced." when the queued PWA items have been successfully delivered/accepted.
	• Offline clock-in feedback should clearly distinguish clock-in from login/authentication. Preferred wording concept: "Clock-in saved. You're offline. It will sync when you reconnect."
	• Terminology rule: log in = PIN authentication; clock in = begin shift; sync = deliver saved work. Avoid calling a queued clock-in a queued "login".
	• The PWA does not need a Siri-specific "Siri note sent" HUD in v1. Keep the PWA recovery wording generic; after the phone's queued shift event syncs, the already-durable Siri note can reconcile independently.
	• Treat this as TEST-only companion behavior first. Prefer a small separate TEST PWA PR. Any frontend PR must bump the TEST service-worker/cache version.
	
	
	•	Formalize cleaning-note storage. Right now add_note appends into the existing Clock Out Note column as a compatibility move, which works, but it is still a transitional schema.
	
	
	•	Admin access controls / quality-of-life tools: disable cleaner, rotate PIN, maybe later promote to trusted access without editing code.
	
	•   Finish invoice: footer, variables like Client, INV number etc should be lined up.  Verify cleaning notes display properly. 
	
	• Roll out the payroll functionality.
	• Total hours doesn't change when I tweak the times in the sheet. Create another column that calculates time and copy paste as value into live column?  Will the change in the sheet's total hours for the shift reflect in the running total of the subsequent emails and the payroll?
	• disable ensure invoicecontrolsheet and delete the test
	• payroll email and spreadsheet
	• invoice spreadsheet– open, past due and paid	
	

Hide cleaning note in drop down when clocked out.

work history keeps transit time after row deleted


	
🔄 Rollout hardening / final tweaks
	• Verify layout on iPhone during live field test with main cleaner


----OFFLINE MODE----	
	
🔧 Offline System (Phase 2 – Future Build)

Goal:
Allow the app to open and function without internet, including login persistence and clock-in/out capability.

⸻

✅ Current State (Already Working)
	•	Session token stored locally
	•	Auth cache stored (cleaner name, properties, shift)
	•	Offline queue for submissions works
	•	App functions offline only if already open/logged in

⸻

🚧 Phase 2 Scope (What we’re actually building later)

1. Offline App Shell (Website Layer)
	•	Create a lightweight website wrapper (your icon site becomes the shell)
	•	Add service worker
	•	Cache:
	•	HTML
	•	CSS
	•	JS
	•	icon assets

👉 Result: app opens from home screen with no internet

⸻

2. Cached Session Boot
	•	Load app using:
	•	AUTH_CACHE_KEY
	•	SESSION_TOKEN_KEY
	•	Skip server call when offline

👉 Result:
Cleaner taps icon → app opens directly into their session

⸻

3. Offline Login Strategy (Simplified)
	•	Keep current rule for now:
	•	❌ No PIN login if fully offline (unless already cached)
	•	Future option (optional):
	•	store hashed PIN locally for offline validation

👉 Decision: defer full offline PIN login for now

⸻

4. Offline Queue (Already Built)
	•	Continue using:
	•	OFFLINE_QUEUE_KEY
	•	Enhance:
	•	clearer UI feedback (offline mode indicator)

⸻

5. Sync on Reconnect (Already Built)
	•	Auto-sync when:
	•	app loads online
	•	connection returns

⸻

⚠️ Accepted Tradeoffs (By Design)
	•	Offline PIN login not supported (for now)
	•	Session must be established once online
	•	Phone time used for timestamps
	•	If phone is lost → handled manually (disable later)

⸻

💡 Optional Improvements (Later)
	•	Switch from localStorage → IndexedDB
	•	Add “Offline Mode” banner
	•	Add retry UI / sync status indicator
	•	Optional offline PIN validation (low priority)

⸻

🧠 Notes

This is not a small tweak — it’s a controlled upgrade:
	•	Moves app toward PWA behavior
	•	Requires careful testing on iOS
	•	Should be done in a focused phase, not incrementally

⸻

✔️ Priority
Low (for now)
Revisit when:
	•	more cleaners
	•	more offline issues
	•	or manual backfill becomes annoying

⸻

My honest take

This is a perfectly scoped version of offline:
	•	not overengineered
	•	not pretending to be enterprise
	•	solves your real-world problem when you’re ready

⸻

If you want next:
👉 I can later turn this into a step-by-step build checklist (like we did with invoices) so when you revisit it, it’s plug-and-play instead of “relearn everything” mode.	
	
  */
	/**
	
	SIRI / APPLE WATCH NOTE CAPTURE — TEST ONLY (updated 2026-09-07)
	
	Backend / physical validation status (2026-09-07):
	• TEST-only Siri backend is merged, deployed, and physically validated for a real cleaning-note flow. PR #87 added the durable Siri backend; PR #88 added the TEST relay signing-ring installer. No Live rollout authorized.
	• Kyle's dedicated TEST Siri credential is issued and working. It is note-only, revocable, cleaner-bound server-side, approximately 90-day pilot scope, and cannot clock in/out or read property information.
	• Frozen v1 request contract remains exactly four client fields: request_id, captured_at, note_type, note. Shortcut does not send property, cleaner identity, PIN, session, or device identifiers.
	• Definite durable D1 acceptance counts as saved and permits Shortcut local-pending cleanup. Spreadsheet application may occur later.
	• Never pin an open shift. Resolve only exactly one completed interval containing original captured_at; ambiguous identity/property/intervals are held for review.
	• Recovery wording remains: "Note queued. Please open the Clean Energy app now so any saved clock-in can sync."

	Physical TEST milestone (2026-09-07):
	• Real iPhone Shortcut "CEH Cleaning Note TEST" reached the TEST Worker with the real credential and received ok:true, environment:"test", durable:true, state:"accepted", client_action:"clear_pending", message:"Cleaning note saved".
	• After Kyle clocked out of the TEST shift, the accepted cleaning note reconciled to the correct completed TEST Time Tracker row and appeared in Clock Out Note exactly once.
	• An earlier independently accepted direct diagnostic Siri request also reconciled after clock-out. This physically demonstrated that multiple durable Siri notes can wait while the shift is open and later apply after a unique completed capture-time interval exists.
	• Initial physical Shortcut failures were caused by one leading space before "ceh-" in the Shortcut request-ID Text action. The Worker correctly rejected it as request_id_format. Removing the space fixed the client request; no backend contract relaxation was needed.
	• Direct authenticated POST using the Shortcut credential also returned HTTP 202/durable:true with the same valid payload contract, confirming credential + Worker + payload behavior independently of Shortcuts.

	Temporary TEST diagnostics (PRs #90 and #91):
	• PR #90 added fixed, non-sensitive invalid_request reason identifiers; PR #91 refined payload validation to fixed field-level reasons. No request values, credentials, headers, note contents, or cleaner identity are logged or returned.
	• Physical diagnostics narrowed the failing Shortcut request from payload_validation to request_id_format, which exposed the leading-space client bug.
	• These diagnostics remain temporarily deployed in TEST. Remove/reassess them after the real Shortcut retry/cleanup behavior is finished and physically validated. No Live change.

	Real Shortcut persistence / remaining client work:
	• Real Shortcut now persists request_id, captured_at, note_type, and note before POST using four separate files under Shortcuts/CEH Siri Pending. Physical read-back proved the saved values are current and correct; stale Files-app previews were only display caching.
	• Earlier disposable iPhone probe physically proved cross-run recovery of an unchanged request ID, original timestamp, note type, and note.
	• Real CEH Shortcut still needs startup detection/reuse of an existing pending request after timeout/unknown outcome; it must retry the exact original request instead of generating a new ID/timestamp.
	• Real CEH Shortcut still needs strict success validation before deleting pending state: HTTP success + ok:true + environment:"test" + matching request_id + durable:true + client_action:"clear_pending".
	• Pending-state deletion and final cleaner-facing spoken success are not yet wired/physically proven in the real Shortcut.
	• Four-file persistence is sequential. Before declaring retry-safe, use the smallest reliable commit/ready marker or equivalent guard so a crash during writes cannot make a later run treat mixed partial state as a complete pending request.
	• Do not rerun the completed durable request as a new note merely to test UI. Next client work should focus on exact retry/cleanup semantics.

	Status / experiment results:
	• Throwaway Shortcut "Raven Note Test" was physically tested on iPhone iOS 26.6.1 and Apple Watch watchOS 26.6 with active cellular. "Show on Apple Watch" enabled.
	• Passed: Siri invocation on Apple Watch, dictated-text capture, HTTPS POST to httpbin, returned JSON display/parsing, extraction of returned request_id, spoken confirmation based on returned server data, readback of dictated note before send, and cancel preventing the POST branch from running.
	• Full hands-free spoken Yes/No confirmation was not proven; the Watch displayed the send/cancel menu. This is good enough for the throwaway experiment and is not a blocker.
	• Watch support is useful but secondary. iPhone is the primary target; basic Watch functionality is desirable, but do not spend significant time/credits on Watch-specific polish unless it comes naturally.
	• iPhone cross-run persistence is physically proven in the disposable probe; the real Shortcut's exact retry and cleanup path remains unfinished as noted above.
	
	Agreed TEST-only architecture direction:
	• Build Siri note intake as a specialized sibling to the existing TEST relay, reusing durability/security/delivery helpers where practical without joining the PWA enrollment/session lifecycle.
	• Dedicated Siri credential: note-only authority, revocable, bound to cleaner identity server-side, approximately 90-day pilot expiry. Do not reuse cleaner PINs or PWA relay credentials. No property-information access and no clock-in/out authority.
	• Shortcut should not send property details.
	• Preferred architecture to validate before implementation: authenticate Siri → durably accept the note into TEST D1 immediately → preserve immutable request ID/original timestamp → resolve/pin/apply the correct completed authoritative shift/property during idempotent Apps Script reconciliation once a unique capture-time interval is available. Do not require property resolution before durable D1 acceptance unless current code proves that is safer/smaller.
	• If an offline PWA clock-in/out still exists only on the phone, that event is inherently invisible to Worker/Apps Script. Do not invent global cross-lane ordering to hide this physical limitation. Keep the Siri note durable, wait/retry reconciliation, and guide the cleaner to open the CEH app so the phone can sync its queued shift event.
	• Duplicate retry model: same request ID + same original payload returns the existing request/outcome; same request ID with changed content/time/type is a conflict. A timeout is an unknown outcome, not proof that the note failed.
	• Preserve original note timestamp and cleaner identity. Keep request IDs/idempotency state in backend state, not visible spreadsheet/property cells.
	• Cleaning note → current clean's existing Time Tracker note path. Existing transitional cleaning-note schema still needs formalization separately.
	• Deep-clean note → append to the property's Deep Clean Items while preserving existing entries. Visible entry format should include timestamp, cleaner, and note, e.g. [2026-09-03 5:42 PM] Kyle Wescott — Clean upper kitchen cabinet interiors. Future report parsing is desirable but out of scope for initial Siri implementation.
	• Property note → durable review/email path to Kyle for manual curation. Never automatically edit House Notes. Be explicit that ambiguous email outcomes cannot be promised as exactly-once delivery.
	
	Post-Kyle-pilot Siri crew onboarding investigation:
	• If Kyle's physical pilot proves Siri useful, investigate whether crew onboarding can be simplified to one shared note-only Siri credential plus a first-run dynamic cleaner picker.
	• Preferred setup concept: shared Shortcut link → cleaner approves permissions → first run fetches current active cleaner names → cleaner selects their name once → Shortcut stores the corresponding stable User ID locally for later note/shift resolution.
	• Do NOT use or store cleaner PINs as Siri identity. Keep PIN authentication separate from non-secret User ID selection.
	• Evaluate the minimum safe read/setup endpoint needed for the dynamic cleaner list, whether the shared credential may authorize it, and whether exposing active cleaner names is acceptable.
	• Evaluate accepted-risk tradeoffs before implementation: a holder of the shared note-only credential could submit bogus notes or claim another cleaner's User ID; one leaked/rotated shared credential would affect every installed crew Shortcut. Confirm that note-only authority remains unable to clock in/out or read property information.
	• Compare this shared-credential approach against individual Siri credentials for onboarding effort, selective revocation, rotation/recovery, and long-term maintenance. No crew rollout or Live change until the Kyle-only TEST pilot is physically validated and this tradeoff is explicitly approved.
	
	Agreed cleaner-facing Siri wording / HUD behavior:
	• Normal type-specific completion wording remains short: "Cleaning note saved", "Deep clean note saved", "Property note received". Request IDs stay invisible to cleaners.
	• If Siri reaches Cloudflare but the cleaner's offline clock-in is still waiting on the phone, durably queue the note and say exactly: "Note queued. Please open the Clean Energy app now so any saved clock-in can sync."
	• The Siri note should remain safely accepted while the cleaner opens the CEH app; the cleaner should not have to dictate the note again.
	
	Agreed TEST PWA relay-recovery polish:
	• When the app is opened/focused, inspect local relay state before PIN entry.
	• If there are NO locally queued PWA relay items, preserve today's fast local-first PIN/unlock behavior with no added network wait.
	• If locally queued relay items DO exist and connectivity is available, sync them before allowing PIN entry. Temporarily disable/freeze the PIN keypad only for the actual queued-sync operation so the cleaner cannot enter the PIN while that recovery sync is in progress.
	• Recovery HUD wording: show "Syncing queued items…" while the pre-PIN relay flush is running, then "All queued items synced." when the queued PWA items have been successfully delivered/accepted.
	• Offline clock-in feedback should clearly distinguish clock-in from login/authentication. Preferred wording concept: "Clock-in saved. You're offline. It will sync when you reconnect."
	• Terminology rule: log in = PIN authentication; clock in = begin shift; sync = deliver saved work. Avoid calling a queued clock-in a queued "login".
	• The PWA does not need a Siri-specific "Siri note sent" HUD in v1. Keep the PWA recovery wording generic; after the phone's queued shift event syncs, the already-durable Siri note can reconcile independently.
	• Treat this as TEST-only companion behavior first. Prefer a small separate TEST PWA PR from the Siri backend PR unless implementation review proves they must be coupled for safe validation. Any frontend PR must bump the TEST service-worker/cache version.
	
	Next Triforce step:
	• Resume the real iPhone Shortcut from its now-working durable cleaning-note POST.
	• Finish real pending-request semantics: detect/reuse existing pending state across runs, guard against partial four-file writes, validate the exact success contract, delete pending only after definite durable success, and preserve the exact original request on timeout/unknown outcome.
	• Physically prove one exact retry of the same request ID/payload after an unknown-outcome simulation, then prove successful pending cleanup without creating a duplicate spreadsheet note.
	• After client retry/cleanup is proven, remove/reassess the temporary TEST diagnostic reason fields in a small cleanup PR.
	• Deep-clean and property-note physical paths still need separate validation after the cleaning-note client is complete.
	• TEST PWA recovery seams are identified; the separate frontend PR remains unimplemented and should stay separate unless needed for the offline queued-shift scenario. No Live changes until TEST pilot validation is complete.
	
	
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
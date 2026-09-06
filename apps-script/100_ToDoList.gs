	/**
	
	SIRI / APPLE WATCH NOTE CAPTURE — TEST ONLY (2026-09-06)
	
	Status / experiment results:
	• Throwaway Shortcut "Raven Note Test" built and physically tested on iPhone iOS 26.6.1 and Apple Watch watchOS 26.6 with active cellular. "Show on Apple Watch" enabled.
	• Passed: Siri invocation on Apple Watch, dictated-text capture, HTTPS POST to httpbin, returned JSON display/parsing, extraction of returned request_id, spoken confirmation based on returned server data, readback of dictated note before send, and cancel preventing the POST branch from running.
	• httpbin echo proves request/header transport only. It does NOT prove durable saving, authentication enforcement, exactly-once behavior, or what happened if a response was lost.
	• Full hands-free spoken Yes/No confirmation was not proven; the Watch displayed the send/cancel menu. This is good enough for the throwaway experiment and is not a blocker for backend investigation.
	• Cross-run failed-submission persistence/retry was intentionally NOT physically tested. The real design must not depend on temporary Shortcut variables preserving the original note, timestamp, or request ID across separate failed runs. Durable retry/request identity must be explicit in the TEST Siri/relay design.
	
	Agreed TEST-only design direction:
	• Build Siri note intake as a specialized sibling to the existing TEST relay, reusing durability/security/delivery helpers where practical without changing PWA behavior or session lifecycle.
	• Dedicated Siri credential: note-only authority, revocable, bound to cleaner identity server-side, approximately 90-day pilot expiry. Do not reuse cleaner PINs or PWA relay credentials. No property-information access and no clock-in/out authority.
	• Shortcut should not send property details. Resolve the active property server-side from backend shift state.
	• If clock-in/out state is still syncing and current property cannot be resolved safely, reject with a clear retry-shortly response rather than introducing complex cross-lane ordering.
	• Preserve original note timestamp and cleaner identity. Keep request IDs/idempotency state in backend state, not visible spreadsheet/property cells.
	• Cleaning note → current clean's existing Time Tracker note path. Existing transitional cleaning-note schema still needs formalization separately.
	• Deep-clean note → append to the property's Deep Clean Items while preserving existing entries. Visible entry format should include timestamp, cleaner, and note, e.g. [2026-09-03 5:42 PM] Kyle Wescott — Clean upper kitchen cabinet interiors. Future report parsing is desirable but out of scope for initial Siri implementation.
	• Property note → durable review/email path to Kyle for manual curation. Never automatically edit House Notes. Be explicit that ambiguous email outcomes cannot be promised as exactly-once delivery.
	• Real cleaner-facing success text should be short and type-specific (for example: "Cleaning note saved", "Deep clean note saved", "Property note received"). Request IDs stay invisible to cleaners.
	
	Next step:
	• Before any implementation, re-check current GitHub main, this to-do, and 99_ProjectSummary.gs as needed.
	• Form the Triforce and give Blue Dude/Astra a tightly scoped READ-ONLY investigation. No edits, branch, PR, deployment, Live work, PWA behavior changes, refactors, unrelated fixes, or architecture expansion.
	• Investigation should identify the smallest TEST-only Siri intake seam; exact relay helpers worth reusing; dedicated note-only authentication placement; durable intake/request-ID/original-timestamp handling; server-side cleaner binding; active-property resolution and shift-sync handling; routing for all three note types; exact files/functions that would change; and blockers/unresolved decisions.
	• After reviewing that report, decide whether to authorize a TEST-only implementation PR.
	• Once the backend contract is known, evaluate using Blue Dude Astra through iPhone Mirroring to build/polish the real Shortcut and make future Shortcut changes easier. Do not spend effort polishing the disposable Shortcut first.
	
	
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
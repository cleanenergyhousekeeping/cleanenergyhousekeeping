	/**
	
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
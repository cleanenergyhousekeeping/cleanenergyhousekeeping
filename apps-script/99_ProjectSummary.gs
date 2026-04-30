/**
 * Clean Energy Housekeeping System - Project Summary
 *
 * VERSION NAME:
 * "Stable Field System + HUD + Overlay + Access Control + Shell Offline Sync"
 *
 * DATE:
 * 2026-04-12
 *
 * =====================================================
 * STATUS
 * =====================================================
 * The system is now fully operational in the field.
 * Core workflow (login → property selection → clock in/out → invoice pipeline)
 * is stable, validated, and no longer dependent on legacy Google Forms.
 *
 * The app has transitioned from a fragile prototype into a structured system
 * with proper UX layers, validation, session handling, backend consistency,
 * and a working shell-based offline mode for field use.
 *
 * =====================================================
 * ARCHITECTURE
 * =====================================================
 * Live Web App (Apps Script HTML/JS)
 *   → Apps Script WebApp Service
 *   → Time Tracker Sheet
 *   → Invoice Prep System
 *   → Invoice Generator (Docs)
 *
 * Offline Clock In Shell
 *   → Standalone home-screen shell app
 *   → Local shell auth storage
 *   → Local queued offline entry storage
 *   → Background queue sync back to Apps Script when signal returns
 *
 *
 * =====================================================
 * CORE FEATURES (STABLE)
 * =====================================================
 *
 * 1) Web App UI (Mobile-First)
 * - Custom Apps Script web app (replaced Google Forms)
 * - Large touch-friendly UI optimized for phone use
 * - Clean PIN-based login screen with keypad
 * - Property autocomplete search (no dropdown lag)
 * - Sticky property lock during active shift
 *
 *
 * 2) Authentication + Session System
 * - 4-digit PIN login system (no Google login required)
 * - Session token stored in browser
 * - Auto-login on return visits
 * - Brute-force protection with lockout timer
 * - Session revalidation on app load
 *
 *
 * 3) Access Control System
 * - FULL vs LIMITED access levels implemented
 * - Backend filters sensitive property data
 * - Frontend hides restricted fields dynamically
 * - Access updates automatically on next session load
 *
 *
 * 4) Shift Protection + Validation
 * - Prevents duplicate clock-ins
 * - Prevents clock-out without open shift
 * - Prevents cross-property errors
 * - Prevents notes without active shift
 * - Prevents notes on wrong property
 *
 *
 * 5) Property Workflow UX
 * - Autocomplete property search
 * - Property locks during active shift
 * - Reset after clock-out
 * - Property Info Panel introduced
 *
 * Property Info includes:
 * - Directions (Google Maps link)
 * - Entrance info (restricted by access)
 * - Alarm info (restricted by access)
 * - Wi-Fi + password
 * - Owner names
 * - House notes
 *
 *
 * 6) Directions Integration
 * - "Google Map Directions" button
 * - Appears when property selected
 * - Opens correct address in Maps
 * - Positioned at top of property panel
 *
 *
 * 7) Cleaning Note System
 * - Added "Add Cleaning Note" action
 * - Designed for customer-visible "extras only"
 * - Supports mid-clean notes
 * - Currently stored in Clock Out Note column (transitional design)
 *
 *
 * 8) Real-Time Shift State
 * - "Current Clean Status" block in UI
 * - Shows:
 *   - Current property
 *   - Clock-in time
 * - Persists through refresh and auto-login
 * - Fully driven by Time Tracker open-shift data
 *
 *
 * 9) UI Feedback System
 *
 * A) HUD (Temporary Feedback)
 * - Centered vertically + horizontally
 * - Displays only:
 *   SUCCESS / ERROR
 *   + details on next line
 * - Color coded:
 *   Green = success
 *   Red = error
 * - Auto-dismisses quickly
 *
 * B) Full-Screen Overlay
 * - Used for:
 *   - Auto login
 *   - PIN login
 *   - Form submission
 *   - Offline prep
 * - Displays "Working..." then result message
 * - Clean white overlay with centered card
 *
 * C) Bottom Status Box
 * - Still exists for full verbose messages
 * - No longer cluttering main UI
 *
 *
 * 10) Time Tracker System
 * - Central source of truth
 * - Tracks:
 *   - Clock in/out
 *   - Total hours
 *   - Notes
 *   - Client + property
 *
 *
 * 11) Transit Tracking
 * - Calculates gap time between same-day jobs
 * - Tracks:
 *   - Transit minutes
 *   - Transit hours
 *   - Alert status
 * - Sends alert if >35 minutes
 * - NOT billed to client (payroll-side metric)
 *
 *
 * 12) Invoice System
 * - Pulls from Time Tracker or Invoice Prep
 * - Groups by client + date range
 * - Supports:
 *   - Hourly billing
 *   - Flat rate billing
 *   - Discounts / fees
 * - Generates clean formatted Google Docs invoices
 *
 *
 * 13) Invoice Prep Layer
 * - Intermediate control layer before invoicing
 * - Stores:
 *   - Cleaner breakdowns
 *   - Billing adjustments
 *   - Notes
 * - Enables future audit + manual overrides
 *
 *
 * 14) Email System
 * - Triggered from Web App (not legacy form)
 * - Sends:
 *   - Check-in notifications
 *   - Check-out notifications
 *   - Blocked submission alerts
 *   - Missing clock-out reminders
 * - Fully aligned with Time Tracker (single source)
 *
 *
 * 15) Offline Shell System (NEW - WORKING)
 * - Standalone home-screen Clock In shell app is now working
 * - Shell stores offline auth locally on the phone
 * - Shell stores offline queued entries locally on the phone
 * - Offline entries now sync back automatically when signal returns
 * - Shell refreshes auth before syncing queued entries
 * - Shell sync now uses current shell auth as primary auth during sync
 * - Current shift state is refreshed and preserved through shell sync
 *
 * Shell storage keys:
 * - ce_shell_auth_v1
 * - ce_shell_queue_v1
 *
 * Current shell assets include:
 * - standalone shell page
 * - seed page
 * - manifest
 * - service worker cache
 *
 *
 * =====================================================
 * MAJOR IMPROVEMENTS RECENTLY COMPLETED
 * =====================================================
 *
 * - Rebuilt HUD system (clean + minimal)
 * - Rebuilt overlay system (stable across flows)
 * - Implemented access control (FULL / LIMITED)
 * - Restored + fixed email notification pipeline
 * - Added real-time shift status in UI
 * - Cleaned out legacy Google Form dependencies
 * - Standardized UI feedback (HUD + overlay + status box)
 * - Built shell-based offline clock-in system
 * - Added shell queue storage and reconnect sync
 * - Fixed stale queued-entry issue
 * - Added shell auth refresh before queue sync
 * - Added current-shift + property helper support for shell refresh
 * - Updated seed reset path so clear=1 clears both shell auth and shell queue
 * - Confirmed successful end-to-end offline test:
 *   prep → offline save → reconnect → automatic sync
 *
 *
 * =====================================================
 * OFFLINE MODE - CURRENT BEHAVIOR
 * =====================================================
 *
 * Initial prep:
 * - Live app prepares offline mode
 * - Shell loads prep and stores local shell auth
 *
 * While offline:
 * - Cleaner can save clock-ins, clock-outs, and notes into local queue
 * - Queue remains on device until connection returns
 *
 * When back online:
 * - Shell attempts to refresh auth first
 * - If refresh succeeds, shell syncs queued entries automatically
 * - If refresh fails because session is expired, queue remains safely stored
 *
 * Reset / recovery:
 * - seed.html#clear=1 now clears both:
 *   - ce_shell_auth_v1
 *   - ce_shell_queue_v1
 *
 *
 * =====================================================
 * CURRENT LIMITATIONS
 * =====================================================
 *
 * - Cleaning notes still stored in legacy column (temporary design)
 * - Property data payload still broader than ideal
 * - Users/PINs still partially managed in config (not fully in sheet)
 * - Manual prep-code handoff still exists and adds friction
 * - Shell still tells user to open live app manually if auth refresh fails
 * - Invoice layout still needs final polish (footer, alignment, etc.)
 *
 *
 * =====================================================
 * NEXT PRIORITIES
 * =====================================================
 *
 * - Make shell auto-open offline entry mode when offline and already prepared
 * - Replace manual prep-code handoff with silent background prep / token handoff
 * - Add automatic redirect / return flow when shell auth refresh truly expires
 * - Move PIN + user management fully to Users sheet
 * - Finalize cleaning-note schema (separate structured storage)
 * - Tighten property data exposure (security optimization)
 * - Payroll system (based on Time Tracker + transit)
 * - Invoice final polish + validation pass
 * - Admin controls (enable/disable cleaners, rotate PINs)
 * - iPhone field testing + UI tweaks
 *
 *
 * =====================================================
 * OVERALL ASSESSMENT
 * =====================================================
 *
 * This system is no longer experimental.
 *
 * It is a functioning operational platform with:
 * - Controlled access
 * - Reliable data flow
 * - Field-ready UI
 * - Expandable architecture
 * - Working offline shell capability
 *
 * Remaining work is refinement, automation, and UX polishing —
 * not rescue.
  * - Polished shell queue panel to show latest queued action, property, and save time
 * - Tightened shell submitted-state lock by dimming the full entry form during sync
 * - Added guided empty-state helper text when shell is unlocked but no clean is active
 * - Added welcome-back success HUD when shell unlock completes
  * - Moved shell guidance text to sit directly under Cleaner for a more natural empty-state layout
 * - Reduced extra shell white space above the logo and below the form
 * - Tightened shell unlock keypad centering rules for the main PIN screen
  * - Added shell-only Work History modal with Saturday-Friday weekly summary
 * - Shell Work History now shows total completed hours grouped by property
 * - Added shell work-history total footer and blue Back button under total
 * - Kept live app work-history route untouched while adding a separate shell summary route
  * - Fixed shell PIN card clipping on narrow phones by making unlock and prep card widths border-box safe
   * - Added iPhone safe-area padding to shell work-history top bar and footer
 * - Added app-wide bottom safe-area breathing room for curved-screen phones
  * - Restored transit lines inside shell Work History and included transit in shell weekly totals
 * - Added online shell auth refresh during unlock so permission changes are respected when signal is available
 * - Shell unlock now skips auth refresh completely when offline and falls back safely on weak connections
  * - Upgraded shell Work History from property totals to shift-level rows with clock-in, clock-out, and shift total
 * - Shell transit rows now show start time, end time, route context, and total transit time between same-day jobs
  * - Added retry-based shell auth refresh on startup, unlock, and queue sync
 * - Shell now retries live permission refresh several times before falling back to saved phone data
 * - Preserved fail-open behavior for field reliability so cleaners are less likely to be locked out at a job
 * - Bumped service worker cache version to force newer shell assets onto installed phones
 *
 * =====================================================
 * PAYROLL SYSTEM - CURRENT STATUS
 * =====================================================
 *
 * - Payroll system is now working from Time Tracker data
 * - Payroll cleaner dropdown now supports canonical full names from active Users rows
 * - Payroll Prep rows can be generated from Payroll Control date range + cleaner selection
 * - Payroll Preview and Payroll PDF generation are working as separate deliberate steps
 * - Payroll PDF output now supports:
 *   - daily minimum guarantee
 *   - transit pay
 *   - gas / bonus / adjustment lines
 *   - hiding zero-value optional summary rows
 *   - grouped same-day row presentation
 *   - phone-readable PDF layout for texting
 * - Final payroll workflow now is:
 *   1) Setup Payroll Sheets
 *   2) Populate Payroll Prep
 *   3) Fill pay settings
 *   4) Generate Payroll Preview
 *   5) Generate Payroll PDFs
 * - Added dedicated Payroll custom menu in the spreadsheet for this flow
  * - Added Payroll Defaults sheet support for cleaner-specific default pay rates and daily minimum hours
 * - Payroll now resolves pay settings in this order:
 *   1) exact Payroll Prep row for the selected pay period
 *   2) cleaner default from Payroll Defaults
 *   3) global fallback constants
 * - New Payroll Prep rows now auto-fill from cleaner defaults when available
 */
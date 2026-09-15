# BUILDLOG.md — AI Usage & Engineering Decision Log

In compliance with FlyRank Capstone Ground Rules:
> "Use AI tools freely, but keep BUILDLOG.md honest: where AI helped, where it was wrong, what you changed. You must be able to explain any 2–3 lines of your code that the evaluator picks."

---

## 1. Where AI Helped
1. **Architectural & Schema Scaffolding:**
   - AI structured the multi-tenant schema with Foreign Keys and explicit indices (`idx_widgets_tenant_id`, `idx_submissions_widget_id`, `idx_submissions_idempotency`).
   - Designed the sequence diagram and request path separation (Owner / Customer Origin / Visitor Public Submission).
2. **Deterministic Fallback Chain Implementation:**
   - Generated the two-stage IP geolocation fallback logic: Provider A (`ip-api.com`) with abort timeout &rarr; Provider B (`ipapi.co`) &rarr; graceful degradation to null geo data.
   - Built custom request header overrides (`x-test-mock-geo-a-down`, `x-test-mock-geo-b-down`) so acceptance probes can deterministically verify each fallback tier without waiting for real network timeouts.
3. **Embed Script Generation & DOM Injection:**
   - Generated the zero-dependency pure JavaScript client embed bundle (`widget.v1.js`) that extracts script tag query parameters, fetches cached JSON config, injects an invisible honeypot trap, renders scoped UI styles, and executes cross-origin fetch submissions.

---

## 2. Where AI Was Wrong & How It Was Fixed
1. **Rate Limiting State Bug:**
   - *Issue:* In the initial sliding-window rate limiter implementation, `ipRecord = ipStore.get(ip)` filtered timestamps into a new array variable `ipValidTimestamps`, but then called `ipRecord.push(now)` on the stale reference. This caused `ipStore` to retain the unmodified filtered array, preventing the timestamp count from incrementing during bursts (remaining requests count remained perpetually at 19).
   - *Correction:* Refactored `src/middleware/rateLimit.js` to reassign `ipRecord = ipRecord.filter(...)`, update `ipRecord.push(now)`, and store the updated array back into `ipStore.set(ip, ipRecord)`. Burst testing immediately caught 429 after 20 requests.
2. **Middleware Mounting Order for Public Asset Caching:**
   - *Issue:* In `src/app.js`, `express.static()` was initially mounted before `publicRoutes`. When `GET /widget.v1.js` was requested, `express.static` intercepted the request and tried to pipe a stream without explicit custom long-lived cache headers (`Cache-Control: public, max-age=31536000, immutable`).
   - *Correction:* Reordered middleware to mount `publicRoutes` first, using synchronous file read and `res.send()` with explicit Cache-Control headers before the static file handler.
3. **Sandboxed Socketless Testing:**
   - *Issue:* Initial test suites tried to boot an ephemeral TCP listener with `server.listen(0)` and make requests via standard `fetch('http://127.0.0.1:...')`. In a restricted sandbox environment without loopback networking permissions, this resulted in `connect EPERM 127.0.0.1`.
   - *Correction:* Engineered a custom, socket-free in-memory test runner (`tests/testHelper.js`) utilizing Node's `stream.Readable.from([chunk])` directly into the Express application pipeline. This allowed 100% of probe tests to execute in under 800ms without TCP socket overhead.

---

## 3. Engineering Decisions Made
- **Zero-Dependency Native Stack:** Selected Node 24's native `node:sqlite` and `node:crypto` modules (for scrypt password hashing and HMAC-SHA256 JWT tokens) instead of heavy C++ compiled native addons (`better-sqlite3`, `bcrypt`). This ensures that on any evaluator machine (Linux, macOS, Windows, Docker), `npm run seed && npm start` boots in under 1 second without native compilation errors or network download requirements.
- **Graceful Side-Effect Isolation:** Formulated `SideEffectService` such that background jobs and external notifications (emails/webhooks) are queued into a dedicated `background_jobs` table wrapped in try/catch. If email sending or webhook dispatch crashes, the public submission API still responds with `201 Created` and preserves the lead row in SQLite.
- **Explicit Non-Goal Enforcement:** Kept the frontend minimal and accessible. Avoided building a visual drag-and-drop form designer or bloated React bundles, focusing purely on backend resilience, CORS, caching, and abuse prevention.

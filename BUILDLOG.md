# BUILDLOG.md — AI Usage & Engineering Decision Log

In compliance with FlyRank Capstone Ground Rules:
> "Use AI tools freely, but keep BUILDLOG.md honest: where AI helped, where it was wrong, what you changed. You must be able to explain any 2–3 lines of your code that the evaluator picks."

---

## 1. Where AI Helped
1. **Architectural & Schema Scaffolding:**
   - Structured the multi-tenant database schema with Foreign Keys and explicit indices (`idx_widgets_tenant_id`, `idx_submissions_widget_id`, `idx_submissions_idempotency`).
   - Added a partial unique index `uq_widget_idempotency` on `(widget_id, idempotency_key)` to enforce idempotency at the database storage engine layer.
2. **Deterministic Fallback Chain Implementation:**
   - Built the two-tier IP geolocation fallback logic: Provider A (`ip-api.com`) with abort timeout &rarr; Provider B (`ipapi.co`) &rarr; graceful degradation to null geo data.
   - Built custom request header overrides (`x-test-mock-geo-a-down`, `x-test-mock-geo-b-down`) so acceptance probes can deterministically verify each fallback tier without waiting for real network timeouts.
3. **Embed Script Generation & DOM Injection:**
   - Built the zero-dependency pure JavaScript client embed bundle (`widget.v1.js`) that extracts script tag query parameters, fetches cached JSON config, injects an invisible honeypot trap, renders scoped UI styles, and executes cross-origin fetch submissions.
4. **Resilient Background Worker:**
   - Implemented an asynchronous background outbox worker with deterministic exponential backoff ($2^N$ seconds) and a hard cap of 3 attempts before triggering automated failure alerts.

---

## 2. Where AI Was Wrong & How It Was Fixed
1. **Rate Limiting State Bug:**
   - *Issue:* In the initial sliding-window rate limiter implementation, `ipRecord = ipStore.get(ip)` filtered timestamps into a new array variable `ipValidTimestamps`, but then called `ipRecord.push(now)` on the stale reference. This caused `ipStore` to retain the unmodified filtered array, preventing the timestamp count from incrementing during bursts.
   - *Correction:* Refactored `src/middleware/rateLimit.js` to reassign `ipRecord = ipRecord.filter(...)`, update `ipRecord.push(now)`, and store the updated array back into `ipStore.set(ip, ipRecord)`.
2. **Hardcoded Fallback JWT Secret:**
   - *Issue:* AI initially included a default fallback secret string (`|| 'flyrank-capstone-default-secret...'`) in `security.js` and a dummy value in `docker-compose.yml`.
   - *Correction:* Completely removed all fallback secrets. Built `getJwtSecret()` which enforces that `JWT_SECRET` must be set via environment and must be at least 32 characters long. Updated `docker-compose.yml` to strictly pass `${JWT_SECRET}` from the host environment.
3. **Idempotency Race Condition:**
   - *Issue:* Initially, idempotency was only checked via a preliminary `SELECT` query. Under high concurrency, two identical requests arriving simultaneously could both pass the `SELECT` check and create duplicate rows.
   - *Correction:* Added a database-level `CREATE UNIQUE INDEX uq_widget_idempotency` and wrapped `INSERT` in try/catch to intercept SQLite constraint violations, resolving race conditions by querying the existing row and returning `200 OK`.
4. **Unconditional Trust of `X-Forwarded-For`:**
   - *Issue:* Initial IP extraction blindly read `req.headers['x-forwarded-for']`, which allows malicious clients to spoof their client IP to bypass rate limits.
   - *Correction:* Added `TRUST_PROXY` environment check. Only if `TRUST_PROXY === 'true'` is the forwarded header trusted; otherwise `req.socket.remoteAddress` is strictly enforced.
5. **Test Controls Exposed in Production:**
   - *Issue:* The submission endpoint initially parsed simulation headers (`x-test-mock-geo-a-down`, etc.) unconditionally.
   - *Correction:* Added environment guard: test override headers are strictly ignored unless `process.env.NODE_ENV !== 'production' && process.env.ALLOW_TEST_CONTROLS === 'true'`.

---

## 3. Engineering Decisions Made
- **Zero-Dependency Native Stack:** Selected Node 24's native `node:sqlite` and `node:crypto` modules (for scrypt password hashing and HMAC-SHA256 JWT tokens) instead of heavy C++ compiled native addons (`better-sqlite3`, `bcrypt`). This ensures that on any evaluator machine (Linux, macOS, Windows, Docker), `npm run seed && npm start` boots in under 1 second without native compilation errors or network download requirements.
- **Graceful Side-Effect Isolation:** Formulated `SideEffectService` such that background jobs and external notifications (emails/webhooks) are queued into a dedicated `background_jobs` table wrapped in try/catch. If email sending or webhook dispatch crashes, the public submission API still responds with `201 Created` and preserves the lead row in SQLite.
- **AI Run-Time Cost Tracking ($0.00 Budget Guard):** The core platform is architected to run deterministically with zero paid API or LLM runtime calls, ensuring 100% free operation on the $0 stack.

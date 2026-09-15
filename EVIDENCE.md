# EVIDENCE.md — Acceptance Probes & Requirements Verification

All 14 requirements from Section 6 of the Capstone Brief plus all shared production requirements are verified below with exact test names, outputs, and HTTP transcripts.

---

## 1. Widget Management

### [x] Authenticated CRUD endpoints for widgets; requests without valid auth are rejected.
**Evidence:**
- **Test:** `tests/tenant-isolation.test.js` -> `Unauthenticated requests to protected endpoints are rejected with 401 Unauthorized`
- **Output:**
```
✔ Unauthenticated requests to protected endpoints are rejected with 401 Unauthorized (0.43ms)
```
- **HTTP Transcript:**
```http
GET /api/widgets HTTP/1.1
Host: localhost:3000

HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8

{
  "error": "Unauthorized: Missing or invalid Authorization header. Expected Bearer token."
}
```

---

### [x] Multi-tenant isolation proven: tenant A cannot read or modify tenant B's widgets or submissions.
**Evidence:**
- **Test:** `tests/tenant-isolation.test.js`
- **Output:**
```
✔ Tenant A can list their own widgets, but cannot see Tenant B widgets (0.46ms)
✔ Tenant A cannot read Tenant B single widget (403 Forbidden) (0.29ms)
✔ Tenant A cannot update Tenant B widget (403 Forbidden) (0.34ms)
✔ Tenant A cannot delete Tenant B widget (403 Forbidden) (0.84ms)
✔ Tenant A dashboard submissions only include leads for Tenant A widgets (0.33ms)
```
- **HTTP Transcript (Tenant A querying Tenant B widget):**
```http
GET /api/widgets/wgt_demo_b1 HTTP/1.1
Authorization: Bearer <tenant_a_jwt>

HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{
  "error": "Access denied: Widget belongs to another tenant"
}
```

---

### [x] Embed snippet generated per widget.
**Evidence:**
- **Endpoint:** `GET /api/widgets/wgt_demo_a1`
- **Payload Response:**
```json
{
  "id": "wgt_demo_a1",
  "title": "Product Waitlist Form",
  "embed_snippet": "<script src=\"http://localhost:3000/widget.v1.js?id=wgt_demo_a1\"></script>"
}
```

---

## 2. Widget Delivery

### [x] Public config endpoint serves a small payload with correct HTTP cache headers.
**Evidence:**
- **Test:** `tests/probe1-cross-origin-submission.test.js` -> `Public widget delivery endpoints return bundle and config with correct cache headers`
- **HTTP Transcript:**
```http
GET /api/widgets/wgt_demo_a1/config HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: public, max-age=60, stale-while-revalidate=30
Access-Control-Allow-Origin: *

{
  "id": "wgt_demo_a1",
  "title": "Product Waitlist Form",
  "type": "signup_form",
  "description": "Join our private beta waiting list.",
  "fields": [
    { "name": "name", "type": "text", "label": "Full Name", "required": true },
    { "name": "email", "type": "email", "label": "Work Email", "required": true }
  ],
  "button_text": "Join Priority Waitlist"
}
```

---

### [x] Widget JavaScript is served as a versioned bundle (new version = new URL or cache-bust).
**Evidence:**
- **HTTP Transcript:**
```http
GET /widget.v1.js HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
```

---

### [x] The widget renders on a page served from a different origin than your API.
**Evidence:**
- **Customer Origin:** `http://localhost:5500` (`customer-site/index.html` via `customer-site/serve.js`)
- **Backend API Origin:** `http://localhost:3000`
- **Embed Tag:** `<script src="http://localhost:3000/widget.v1.js?id=wgt_demo_a1"></script>`
- **Output:** Script fetches config cross-origin, injects container, renders form, and sends cross-origin submission to `:3000`.

---

## 3. Public Submission API

### [x] Cross-origin submissions work: CORS headers correct, preflight (OPTIONS) handled.
**Evidence:**
- **Test:** `tests/probe1-cross-origin-submission.test.js` -> `POST a valid submission from a simulated second-origin test page (:5500)`
- **HTTP Preflight Transcript:**
```http
OPTIONS /api/submissions HTTP/1.1
Origin: http://localhost:5500
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5500
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Idempotency-Key
Access-Control-Max-Age: 86400
```

---

### [x] All incoming input validated; malformed and oversized payloads rejected with appropriate 4xx codes and JSON errors.
**Evidence:**
- **Test:** `tests/probe2-validation-and-boundary.test.js` & `tests/schema-validation.test.js`
- **Output:**
```
✔ Send malformed JSON syntax -> returns HTTP 400 Bad Request JSON error (never 500) (4.4ms)
✔ Send oversized payload (> 100KB) -> returns HTTP 413 Payload Too Large (never 500) (0.4ms)
✔ Send invalid input with missing widget_id -> returns HTTP 400 Bad Request JSON error (0.7ms)
✔ Send invalid input with malformed email -> returns HTTP 400 Bad Request JSON error (0.3ms)
✔ Send submission for non-existent widget -> returns HTTP 404 Not Found JSON error (0.3ms)
✔ Missing required field defined in widget schema returns 400 with field error details (0.78ms)
✔ Field exceeding 500 characters maximum length returns 400 Bad Request (0.33ms)
✔ Submission from unauthorized origin is rejected with 403 Forbidden (0.36ms)
```
- **HTTP Transcript (Oversized payload > 100KB):**
```http
POST /api/submissions HTTP/1.1
Content-Length: 122880

HTTP/1.1 413 Payload Too Large
Content-Type: application/json; charset=utf-8

{
  "error": "Payload Too Large: Request body exceeds maximum allowed size of 100KB."
}
```

---

### [x] Valid submissions stored safely, linked to the right widget and tenant.
**Evidence:**
- **Test:** `tests/probe1-cross-origin-submission.test.js`
- **Output:**
```
✔ POST a valid submission from a simulated second-origin test page (:5500) -> 201 Created and visible in Dashboard API (17.8ms)
```
- **Database Row Verification:**
```sql
SELECT id, widget_id, tenant_id, payload, geo_country, geo_city, geo_provider FROM submissions WHERE id = 'sub_48b954db-bae8-4cc3-8bb7-27b6a31e0300';
-- sub_48b954db-bae8-4cc3-8bb7-27b6a31e0300 | wgt_demo_a1 | ten_demo_a | {"name":"Ellen Ripley","email":"ripley@weyland-yutani.com","company":"Nostromo"}
```

---

## 4. Abuse Protection

### [x] Rate limiting per IP and/or per widget returns 429 under a burst — and the API keeps serving legitimate traffic.
**Evidence:**
- **Test:** `tests/probe3-rate-limiting.test.js`
- **Output:**
```
✔ Fire a burst of rapid submissions -> 429 appears and legitimate traffic from another IP succeeds (50.4ms)
```
- **HTTP 429 Transcript:**
```http
POST /api/submissions HTTP/1.1
X-Forwarded-For: 198.51.100.42

HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0

{
  "error": "Too Many Requests: Rate limit exceeded for this IP address.",
  "retry_after_seconds": 60
}
```

---

### [x] At least one spam-prevention technique (honeypot field, token, or heuristic) demonstrably blocks a spam submission.
**Evidence:**
- **Test:** `tests/probe6-honeypot-bot-defense.test.js`
- **Output:**
```
[AntiSpam] Honeypot field "_hp_website" triggered with value: "http://buy-cheap-pills-online.biz"
✔ Bot fills the invisible honeypot field -> submission is immediately blocked and rejected (400 Bad Request) (4.09ms)
```
- **HTTP Transcript:**
```http
POST /api/submissions HTTP/1.1
Content-Type: application/json

{
  "widget_id": "wgt_demo_a1",
  "data": { "name": "SEO Bot", "email": "bot@spam.com" },
  "_hp_website": "http://buy-cheap-pills-online.biz"
}

HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{
  "error": "Bad Request: Spam submission rejected."
}
```

---

## 5. Enrichment & Safe Side Effects

### [x] IP→geo enrichment uses a provider fallback chain: provider A down → provider B answers → submission enriched.
**Evidence:**
- **Test:** `tests/probe4-geo-fallback.test.js` -> `Step 1: Disable Geo Provider A -> submission is stored and enriched by Provider B`
- **Output:**
```
[GeoService] Provider A failed (Provider A simulated offline/unavailable). Falling back to Provider B...
✔ Step 1: Disable Geo Provider A -> submission is stored and enriched by Provider B (ipapi.co) (19.7ms)
```

---

### [x] All providers down → submission still succeeds (without geo). Degrade, never fail.
**Evidence:**
- **Test:** `tests/probe4-geo-fallback.test.js` -> `Step 2: Disable both Provider A and Provider B -> submission still succeeds (201) without geo`
- **Output:**
```
[GeoService] Provider A failed (Provider A simulated offline/unavailable). Falling back to Provider B...
[GeoService] Provider B failed (Provider B simulated offline/unavailable). Fallback chain exhausted.
✔ Step 2: Disable both Provider A and Provider B -> submission still succeeds (201) without geo (Degrade, never fail) (0.81ms)
```

---

### [x] A failing confirmation email / webhook does not prevent the submission from being stored.
**Evidence:**
- **Test:** `tests/probe5-safe-side-effects.test.js`
- **Output:**
```
[SafeSideEffect] Warning: Side-effect failed gracefully without interrupting submission: Simulated side-effect failure (Probe 5)
✔ Force email / webhook side effect to throw -> submission still returns 201 Created and is safely stored in database (19.6ms)
```

---

## 6. Shared Production Requirements Evidence

### [x] Layered Architecture
- Data layer (`src/db/database.js`, `src/db/migrate.js`, `src/db/seed.js`), Logic layer (`src/services/`), HTTP/Routing layer (`src/routes/`, `src/middleware/`).

### [x] ≥ 1 Background Job with Exponential Backoff & Failure Alert
**Evidence:**
- **Test:** `tests/worker-and-retry.test.js`
- **Output:**
```
[BackgroundWorker] Processing job job_test_1 (lead_notification) for submission sub_demo_1
[BackgroundWorker] Job job_fail_1 attempt 1 failed: Simulated background worker dispatch failure. Next retry scheduled at: 2026-09-15 14:09:35 (+2s exponential backoff)
[FAILURE ALERT] Background job job_max_retry exceeded max retries (3)! Alerting incident response: Simulated background worker dispatch failure
✔ Background worker successfully picks up and processes pending jobs (0.96ms)
✔ Worker failure schedules exponential backoff and increments attempt count (0.97ms)
✔ Job permanently fails with alert after reaching maximum retries (attempts >= 3) (0.40ms)
```

### [x] Idempotency Where It Matters & Race Condition Safety
**Evidence:**
- **Database Schema:** `CREATE UNIQUE INDEX uq_widget_idempotency ON submissions(widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`
- **Test:** `tests/idempotency.test.js`
- **Output:**
```
✔ Replaying request with same X-Idempotency-Key returns existing submission without creating duplicates (20.3ms)
✔ Database enforces UNIQUE constraint uq_widget_idempotency at SQL layer (0.5ms)
```
- **HTTP Response on Idempotent Replay:**
```json
{
  "success": true,
  "message": "Idempotent request: submission previously recorded",
  "submission_id": "sub_a79f18a2-2bf1-4e92-9a3b-28f01bda09a2"
}
```

### [x] Dashboard Analytics & Aggregation Queries
**Evidence:**
- **Test:** `tests/dashboard-stats.test.js`
- **Output:**
```
✔ GET /api/dashboard/stats returns correct totals and grouped aggregations (1.2ms)
```
- **Sample Aggregation Payload:**
```json
{
  "total_submissions": 4,
  "per_widget": [
    { "widget_id": "wgt_demo_a1", "title": "Product Waitlist Form", "type": "signup_form", "count": 4 }
  ],
  "counts_over_time": [{ "date": "2026-09-15", "count": 4 }],
  "geo_breakdown": [
    { "country": "United States", "count": 2 },
    { "country": "Australia", "count": 2 }
  ]
}
```

### [x] Clean Secrets & Cryptographic Strength
- No hardcoded secrets in `docker-compose.yml` (uses `${JWT_SECRET}`).
- `getJwtSecret()` strictly requires a secret $\ge 32$ characters long; rejects fallback strings with an explicit fatal error.
- `.env` in `.gitignore` before first commit; committed `.env.example` with safe templates.

### [x] AI Cost & Budget Tracking (Requirement 7)
- **Status:** **Zero LLM Run-Time Dependency / $0.00 Cost Guarded**
- **Evidence:** The core lead-capture platform, abuse filtering, validation pipeline, and geo fallback chain are 100% deterministic and execute natively without invoking paid LLM APIs at runtime.
- **Budget Guard:** `AI_BUDGET_CAP_USD = $0.00`. If AI summarization stretch goals are enabled, calls are attributed per tenant (`metadata: { tenant_id, tokens, cost }`) with a hard budget threshold of \$5.00/month per tenant.

---

## 7. Complete Test Suite Summary
```bash
npm test
```
```
ℹ tests 36
ℹ suites 13
ℹ pass 36
ℹ fail 0
ℹ duration_ms 1295.7ms
```

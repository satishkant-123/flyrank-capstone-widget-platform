# Embeddable Widget & Lead-Capture Platform — System Design

## 1. Problem Statement
Modern web applications frequently embed lead-capture widgets (signup forms, newsletters, demo requests, contact forms) onto arbitrary third-party websites using a single `<script>` snippet. Because these submission endpoints face the open internet and are invoked directly from browsers that the application does not control, they are prime targets for cross-origin attacks, traffic spikes, bot floods, and provider downtime.

This system provides:
1. **Multi-tenant widget management** for website owners to configure forms.
2. **High-performance, cached delivery** of widget assets and configuration.
3. **A hardened public submission pipeline** featuring strict CORS handling, payload validation against widget schema, rate limiting, honeypot spam protection, resilient geolocation enrichment with a multi-provider fallback chain, database-enforced idempotency, and failure-isolated asynchronous side effects.
4. **An owner analytics dashboard** providing metrics and submission tracking.

---

## 2. Data Models, Tenancy & Indexing

### Tenancy Strategy
Tenancy is strictly enforced at the data layer via a `tenant_id` foreign key. Every read, update, or deletion query scoped to customer resources requires matching `tenant_id = :authenticated_tenant_id`. Submissions are linked to their parent `widget_id` and denormalized `tenant_id` to prevent cross-tenant data leakage.

```
+--------------------+        1:N        +-----------------------+        1:N        +-------------------------+
|      Tenants       | ----------------> |        Widgets        | ----------------> |       Submissions       |
+--------------------+                   +-----------------------+                   +-------------------------+
| id (TEXT PK)       |                   | id (TEXT PK)          |                   | id (TEXT PK)            |
| email (TEXT UNIQUE)|                   | tenant_id (TEXT FK)   |                   | widget_id (TEXT FK)     |
| password_hash      |                   | title (TEXT)          |                   | tenant_id (TEXT FK)     |
| name (TEXT)        |                   | type (TEXT)           |                   | payload (TEXT JSON)     |
| created_at (DATETM)|                   | description (TEXT)    |                   | visitor_ip (TEXT)       |
+--------------------+                   | fields (TEXT JSON)    |                   | geo_country (TEXT)      |
                                         | button_text (TEXT)    |                   | geo_city (TEXT)         |
                                         | display_options (JSON)|                   | geo_provider (TEXT)     |
                                         | allowed_origins (JSON)|                   | user_agent (TEXT)       |
                                         | is_active (INTEGER)   |                   | idempotency_key (TEXT)  |
                                         | created_at (DATETIME) |                   | created_at (DATETIME)   |
                                         | updated_at (DATETIME) |                   +-------------------------+
                                         +-----------------------+
```

### Schema DDL & Indexes
```sql
-- Tenants (Customers)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);

-- Widgets
CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'signup_form', -- signup_form | cta | popover
    description TEXT,
    fields TEXT NOT NULL DEFAULT '[]', -- JSON array of field schemas
    button_text TEXT NOT NULL DEFAULT 'Submit',
    display_options TEXT NOT NULL DEFAULT '{}', -- JSON (theme, color, position)
    allowed_origins TEXT NOT NULL DEFAULT '["*"]', -- JSON list of allowed origins
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_widgets_tenant_id ON widgets(tenant_id);

-- Submissions (Leads)
CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    widget_id TEXT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payload TEXT NOT NULL, -- JSON form submission data
    visitor_ip TEXT,
    geo_country TEXT,
    geo_city TEXT,
    geo_provider TEXT, -- 'ip-api' | 'ipapi.co' | 'none'
    user_agent TEXT,
    idempotency_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_submissions_widget_id ON submissions(widget_id);
CREATE INDEX IF NOT EXISTS idx_submissions_tenant_id ON submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);

-- Partial Unique Index guaranteeing strict idempotency per widget when a key is supplied
CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_idempotency ON submissions(widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Background Job / Event Outbox (Side Effects with Exponential Backoff)
CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_schedule ON background_jobs(status, next_retry_at);
```

---

## 3. The Embed Flow
The embed cycle is completely automated and requires only one line of HTML on the customer's page:

```
Customer Website (any origin)
  <script src="http://localhost:3000/widget.v1.js?id=wgt_123"></script>
    --> GET /widget.v1.js (cached long-term, public)
    --> GET /api/widgets/wgt_123/config (cached short-term, public, CORS)
    --> Render form UI into container
    --> User submits form
    --> POST /api/submissions (CORS preflight + boundary validation + idempotency)
    --> 201 Created & stored (or 200 OK on idempotent retry)
```

---

## 4. API Contracts Across the Three Request Paths

### Path 1: Widget Owner (Authenticated via Bearer JWT)
- **POST `/api/auth/signup`**: Create tenant account (password complexity enforced, rate-limited).
- **POST `/api/auth/login`**: Authenticate, returns `{ access_token, tenant }` (rate-limited).
- **GET `/api/auth/me`**: Returns tenant profile.
- **GET `/api/widgets`**: Lists all widgets owned by tenant (`WHERE tenant_id = ?`).
- **POST `/api/widgets`**: Creates a new widget; returns widget object + `embed_snippet` (strictly validated fields & origins).
- **GET `/api/widgets/:id`**: Gets single widget details + `embed_snippet`.
- **PUT `/api/widgets/:id`**: Updates widget configuration.
- **DELETE `/api/widgets/:id`**: Deletes widget.
- **GET `/api/dashboard/stats`**: Aggregated counts, submissions over time, geo breakdown.
- **GET `/api/dashboard/submissions`**: Paginated list of submissions for owner's widgets.

### Path 2: Customer Website (Public, Cached, Cross-Origin)
- **GET `/widget.v1.js`**:
  - `Cache-Control: public, max-age=31536000, immutable`
  - Versioned script bundle containing the embed engine.
- **GET `/api/widgets/:id/config`**:
  - `Cache-Control: public, max-age=60, stale-while-revalidate=30`
  - `Access-Control-Allow-Origin: *`
  - Returns small public configuration JSON without internal metadata.

### Path 3: Website Visitor (Public, CORS, Abuse-Protected)
- **OPTIONS `/api/submissions`**: Handled with 204 No Content and appropriate CORS headers.
- **POST `/api/submissions`**:
  - Headers: `Content-Type: application/json`, optional `X-Idempotency-Key`.
  - Enforces schema matching, required fields, and string length restrictions.
  - Enforces `allowed_origins` (returns 403 if origin not authorized).
  - Handles concurrent idempotency race conditions cleanly.
  - Responses:
    - `201 Created`: `{ "success": true, "submission_id": "sub_456" }`
    - `200 OK`: `{ "success": true, "message": "Idempotent request: submission previously recorded", "submission_id": "sub_456" }`
    - `400 Bad Request`: `{ "error": "Schema Validation Error", "details": [...] }`
    - `400 Bad Request`: `{ "error": "Spam submission rejected" }` (honeypot triggered)
    - `403 Forbidden`: `{ "error": "Forbidden: Origin is not authorized" }`
    - `404 Not Found`: `{ "error": "Widget not found" }`
    - `413 Payload Too Large`: `{ "error": "Payload exceeds 100KB maximum size" }`
    - `429 Too Many Requests`: `{ "error": "Rate limit exceeded" }`

---

## 5. Explicit Non-Goal
**Non-Goal:** We will not build a drag-and-drop WYSIWYG visual form builder or complex multi-page conditional branching survey engine. The platform strictly targets **embeddable lead-capture and CTA widgets**, prioritizing backend boundary hardening, multi-tenant data isolation, HTTP caching compliance, cross-origin resilience, deterministic fallback chains, and race-safe idempotency.

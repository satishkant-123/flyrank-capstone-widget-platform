# Embeddable Widget & Lead-Capture Platform — System Design

## 1. Problem Statement
Modern web applications frequently embed lead-capture widgets (signup forms, newsletters, demo requests, contact forms) onto arbitrary third-party websites using a single `<script>` snippet. Because these submission endpoints face the open internet and are invoked directly from browsers that the application does not control, they are prime targets for cross-origin attacks, traffic spikes, bot floods, and provider downtime.

This system provides:
1. **Multi-tenant widget management** for website owners to configure forms.
2. **High-performance, cached delivery** of widget assets and configuration.
3. **A hardened public submission pipeline** featuring strict CORS handling, payload validation, rate limiting, honeypot spam protection, resilient geolocation enrichment with a multi-provider fallback chain, and failure-isolated asynchronous side effects.
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
                                         | is_active (INTEGER)   |                   | created_at (DATETIME)   |
                                         | created_at (DATETIME) |                   +-------------------------+
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
    fields TEXT NOT NULL DEFAULT '[]', -- JSON definition of form fields
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_submissions_widget_id ON submissions(widget_id);
CREATE INDEX IF NOT EXISTS idx_submissions_tenant_id ON submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);

-- Background Job / Event Outbox (Side Effects)
CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON background_jobs(status);
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
    --> POST /api/submissions (CORS preflight + boundary validation)
    --> 201 Created & stored
```

---

## 4. API Contracts Across the Three Request Paths

### Path 1: Widget Owner (Authenticated via Bearer JWT)
- **POST `/api/auth/signup`**: Create tenant account.
- **POST `/api/auth/login`**: Authenticate, returns `{ access_token, tenant }`.
- **GET `/api/auth/me`**: Returns tenant profile.
- **GET `/api/widgets`**: Lists all widgets owned by tenant (`WHERE tenant_id = ?`).
- **POST `/api/widgets`**: Creates a new widget; returns widget object + `embed_snippet`.
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
  - Returns:
    ```json
    {
      "id": "wgt_123",
      "title": "Join our Developer Beta",
      "description": "Get early access to our platform.",
      "type": "signup_form",
      "button_text": "Join Waitlist",
      "fields": [
        { "name": "name", "type": "text", "label": "Full Name", "required": true },
        { "name": "email", "type": "email", "label": "Email Address", "required": true }
      ],
      "display_options": { "theme": "dark", "position": "bottom-right" }
    }
    ```

### Path 3: Website Visitor (Public, CORS, Abuse-Protected)
- **OPTIONS `/api/submissions`**: Handled with 204 No Content and appropriate CORS headers.
- **POST `/api/submissions`**:
  - Headers: `Content-Type: application/json`, optional `X-Idempotency-Key`.
  - Body:
    ```json
    {
      "widget_id": "wgt_123",
      "data": {
        "name": "Alex Smith",
        "email": "alex@example.com"
      },
      "_hp_website": ""
    }
    ```
  - Responses:
    - `201 Created`: `{ "success": true, "submission_id": "sub_456" }`
    - `400 Bad Request`: `{ "error": "Validation failed", "details": [...] }`
    - `400 Bad Request`: `{ "error": "Spam submission detected" }` (if honeypot filled)
    - `404 Not Found`: `{ "error": "Widget not found" }`
    - `413 Payload Too Large`: `{ "error": "Payload exceeds 100KB maximum size" }`
    - `429 Too Many Requests`: `{ "error": "Rate limit exceeded. Please retry later." }`

---

## 5. Explicit Non-Goal
**Non-Goal:** We will not build a drag-and-drop WYSIWYG visual form builder or complex form logic workflow engine (e.g. conditional branching, multi-page surveys). The platform strictly targets **embeddable lead-capture and CTA widgets**, prioritizing backend boundary hardening, multi-tenant data isolation, HTTP caching compliance, cross-origin resilience, and fault-tolerant third-party fallback chains.

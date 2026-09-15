# FlyRank Embeddable Widget & Lead-Capture Platform

> **Backend Track Capstone Project**  
> Repository Name: `flyrank-capstone-widget-platform`  
> Let a customer define a widget, hand them one line of `<script>`, and safely catch everything the public internet throws back at you — validated, spam-filtered, enriched, and dashboarded.

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Acceptance%20Probes-36%2F36%20Passing-brightgreen.svg)]()

---

## 1. What the System Does

Modern web platforms enable users to embed forms, banners, and lead-capture popovers onto external websites using a single `<script>` tag (similar to Mailchimp, Typeform, or Intercom). 

Because submissions originate from arbitrary browsers and origins not controlled by the backend, this platform implements production-grade backend hardening:
1. **Multi-Tenant Isolation:** Complete data separation for widget owners. Customer A can never see, modify, or delete Customer B's widgets or submissions.
2. **Versioned Asset & Config Delivery:** Serves the embed script bundle with long-term caching (`Cache-Control: public, max-age=31536000, immutable`) and config with short-lived caching (`max-age=60`).
3. **Boundary & Schema Validation:** 
   - Content size limits (< 100KB) rejected with `413 Payload Too Large`.
   - Malformed JSON syntax rejected with clean `400 Bad Request` JSON responses (never leaking 500 errors).
   - Widget schema validation: checks required fields, field lengths (max 500 chars), and strict field types (`text`, `email`, `number`, `url`).
   - Domain origin protection: enforces `allowed_origins` per widget (rejects unauthorized origins with `403 Forbidden`).
4. **Abuse Protection:**
   - Sliding-window rate limiting per IP and per widget (returning `429 Too Many Requests`).
   - Dedicated authentication rate limiting to prevent brute-force attacks.
   - Invisible honeypot traps (`_hp_website`) blocking automated spam bots.
5. **Resilient Geolocation Fallback Chain:**
   - Provider A (`ip-api.com`) &rarr; Provider B (`ipapi.co`) &rarr; Graceful Degradation (stores submission without geo if both providers are offline). Degrades, never fails!
6. **Safe Asynchronous Side Effects & Queue Worker:** 
   - Secondary notification actions (email notifications, webhooks) run out-of-band and are failure-isolated: a failing side-effect never interrupts the `201 Created` HTTP response.
   - Resilient background worker with true exponential backoff ($2^N$ seconds) and failure alerts.
7. **Idempotency & Race Condition Safety:**
   - Database-level unique constraint on `(widget_id, idempotency_key)` preventing duplicate submissions under network retries or concurrent clicks.
8. **Owner Dashboard & Analytics:** Real-time metrics on submission counts over time, widget performance, and geolocation distribution.

---

## 2. Architecture Overview

```
                                  +-----------------------+
                                  |     WIDGET OWNER      |
                                  +-----------------------+
                                              |
                                              | JWT Authentication (>= 32 chars)
                                              v
                              +-------------------------------+
                              |    Widget Management API      |
                              | - CRUD operations             |
                              | - Multi-tenant isolation      |
                              | - Embed snippet generation    |
                              +-------------------------------+
                                              |
                                              v
                                      +---------------+
                                      |   Database    |
                                      |  (SQLite WAL) |
                                      +---------------+
                                              ^
                                              | (Stored lead)
                                              |
+------------------------------+              |
|   CUSTOMER WEBSITE (:5500)   |              |
+------------------------------+              |
  |                                           |
  | 1. <script src="/widget.v1.js?id=...">    |
  v                                           |
+--------------------------------------+      |
| Public Delivery Engine (:3000)       |      |
| - GET /widget.v1.js (1 yr immutable) |      |
| - GET /api/widgets/:id/config (60s)  |      |
+--------------------------------------+      |
  |                                           |
  | 2. Renders Form UI in DOM                 |
  v                                           |
+-------------------------------------------------------------------------+
|                  PUBLIC SUBMISSION PIPELINE (:3000)                     |
|                                                                         |
| 1. Cross-Origin Preflight Check (OPTIONS -> 204 No Content)             |
| 2. Boundary & Schema Validation (Payload < 100KB, JSON syntax, 4xx)     |
| 3. Domain Origin Check (allowed_origins check -> 403 if unauthorized)   |
| 4. Abuse Protection (Sliding Rate Limiter per IP & per Widget -> 429)   |
| 5. Honeypot Spam Filter (_hp_website bot field -> 400 Rejected)         |
| 6. Idempotency Check (DB Unique Index -> 200 OK on replayed request)    |
| 7. IP Geolocation Fallback Chain:                                       |
|      Provider A (ip-api.com)                                            |
|        │ (fails)                                                        |
|        └──> Provider B (ipapi.co)                                       |
|               │ (fails)                                                 |
|               └──> Store lead anyway without geo data (Degrade!)        |
| 8. Safe Side-Effects (Queued outbox job - failure never crashes 201)    |
| 9. Background Worker (Processes outbox with exponential backoff)        |
+-------------------------------------------------------------------------+
```

---

## 3. Quickstart & Setup Instructions

### Prerequisites
- Node.js v20+ (Node 24 recommended for zero-dependency native SQLite & Crypto)
- Git

### One-Command Setup & Seed
```bash
# 1. Clone repository
git clone https://github.com/satishkant-123/flyrank-capstone-widget-platform.git
cd flyrank-capstone-widget-platform

# 2. Copy environment file (ensure JWT_SECRET is set to >= 32 characters)
cp .env.example .env

# 3. Install dependencies ($0 stack: express + dotenv)
npm install

# 4. Seed demo tenants, widgets, and sample leads
npm run seed

# 5. Start API server (port 3000)
npm start
```

### Starting the Second-Origin Customer Test Page
In a second terminal window, run the customer site to simulate a separate origin on port 5500:
```bash
npm run serve:customer
```
Now visit **http://localhost:5500** in your browser to see the live widget embedded cross-origin!

### Running via Docker Compose
Ensure `JWT_SECRET` is set in your environment (or `.env` file):
```bash
export JWT_SECRET="flyrank_capstone_secure_production_secret_key_minimum_32_characters_2026"
docker compose up --build
```
The Docker container automatically seeds demo data, runs the API server on `http://localhost:3000`, and exposes the customer test site on `http://localhost:5500`.

---

## 4. Demo Credentials (For Testing Only)

> [!NOTE]
> **DEMO ONLY:** The following pre-seeded credentials are provided strictly for local demonstration and automated evaluator probe execution. Do not use in production.

| Role | Email | Password | Access / Tenant Scope |
|---|---|---|---|
| Tenant A (Demo) | `tenant_a@example.com` | `Password123!` | Manages Widget `wgt_demo_a1` |
| Tenant B (Demo) | `tenant_b@example.com` | `Password123!` | Manages Widget `wgt_demo_b1` |

Access the Owner Dashboard at **http://localhost:3000/dashboard**.

---

## 5. API Reference

### Public Widget Delivery
| Method | Endpoint | Cache-Control | Description |
|---|---|---|---|
| `GET` | `/widget.v1.js` | `public, max-age=31536000, immutable` | Versioned client embed bundle |
| `GET` | `/widget.js` | `public, max-age=3600` | Unversioned alias entrypoint |
| `GET` | `/api/widgets/:id/config` | `public, max-age=60, stale-while-revalidate=30` | Public widget config JSON |

### Public Submissions (CORS Enabled)
| Method | Endpoint | Status Codes | Description |
|---|---|---|---|
| `OPTIONS` | `/api/submissions` | `204` | CORS preflight handling |
| `POST` | `/api/submissions` | `200`, `201`, `400`, `403`, `404`, `413`, `429` | Validated, rate-limited public lead submission |

**Submission Payload Format:**
```json
{
  "widget_id": "wgt_demo_a1",
  "data": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "company": "Acme Inc"
  },
  "_hp_website": ""
}
```

### Authenticated Tenant Management (`Authorization: Bearer <token>`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/signup` | Register new tenant customer (rate-limited, password complexity checked) |
| `POST` | `/api/auth/login` | Log in, returns JWT access token (rate-limited) |
| `GET` | `/api/auth/me` | Current tenant profile |
| `GET` | `/api/widgets` | List tenant's widgets |
| `POST` | `/api/widgets` | Create new widget + generate snippet (strictly validates schema & origins) |
| `GET` | `/api/widgets/:id` | Get widget by ID (tenant-scoped) |
| `PUT` | `/api/widgets/:id` | Update widget config |
| `DELETE` | `/api/widgets/:id` | Delete widget |
| `GET` | `/api/dashboard/stats` | Aggregated analytics & geo metrics |
| `GET` | `/api/dashboard/submissions` | Paginated lead list |

---

## 6. Running Acceptance Tests

Run the automated test suite verifying all 6 evaluation probes, multi-tenant isolation, background retries, and schema bounds:
```bash
npm test
```

### Acceptance Probes Coverage
- **PROBE 1:** Cross-origin POST submission from second-origin (`:5500`) stored with 2xx and visible in dashboard.
- **PROBE 2:** Malformed JSON and > 100KB payloads return clean `400` / `413` JSON errors, never 500.
- **PROBE 3:** Rapid burst of 25 submissions triggers `429 Too Many Requests`, while legitimate traffic immediately succeeds.
- **PROBE 4:** Disable Provider A &rarr; Provider B enriches submission. Disable both &rarr; submission stores cleanly without geo.
- **PROBE 5:** Force email/webhook side-effect to throw &rarr; submission returns `201 Created` and stores safely.
- **PROBE 6:** Honeypot field filled by bot &rarr; rejected with `400 Bad Request` without storing spam.
- **Multi-Tenant Isolation:** Tenant A cannot read, update, or delete Tenant B widgets or leads (`403 Forbidden`).
- **Idempotency & Race Safety:** Database unique index prevents duplicate rows; concurrent duplicates return `200 OK`.
- **Background Worker & Backoff:** Outbox jobs retried with true exponential backoff; failures alert after 3 attempts.
- **Schema & Origin Validation:** Missing required fields, invalid types, strings > 500 chars, and disallowed origins rejected with clean 4xx errors.

---

## 7. Honest Limitations

1. **In-Memory Rate Limiting:** Rate limiting uses an in-memory sliding window algorithm. In a multi-instance horizontally scaled production deployment, this would be backed by Redis or an API Gateway (Cloudflare / Envoy).
2. **Local SQLite Persistence:** Designed around SQLite with WAL mode for lightweight, zero-dependency deployment and testing. In a multi-region cloud deployment, PostgreSQL with read replicas would be utilized.
3. **No WYSIWYG Form Builder:** In alignment with Section 7 (Realistic Scope & Non-Goals), this project deliberately focuses on backend resilience, boundary validation, idempotency, and fallback chains rather than building a visual drag-and-drop form canvas.

# Quickstop Super Deli — Online Ordering System Implementation Plan

## Context

Quickstop Super Deli needs a complete online ordering system on their existing website. Customers should browse the menu, customize items, add to cart, checkout with payment, and have orders appear on the store's Clover POS for preparation. The store also needs self-managed delivery (own drivers, $50 min, 10-mile radius), scheduled/advance orders, a store-side order management dashboard, and an admin interface for settings and specials.

The deli recently switched to **Clover POS**, which locks them into Clover/Fiserv payment processing at **3.5% + $0.10** for card-not-present transactions. The system will use Clover's **Iframe SDK** (card data never touches our server) and **Atomic Order API** (orders appear directly on the POS device).

### Key Decisions
- **Payment**: Clover Iframe SDK + Ecommerce API (3.5% + $0.10, unavoidable)
- **Backend**: Extend existing Cloudflare Worker with D1 (SQLite) + KV (sessions)
- **Geocoding**: Mapbox (50K free/month, accurate for US addresses)
- **Auth**: Simple shared PIN (store PIN + admin PIN), SHA-256 hashed
- **Customer accounts**: Guest checkout only (name, phone, email)
- **Service fee**: Built as a toggle, owner decides later
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks, no build system)
- **Hosting**: Static files on Hostinger, API on Cloudflare Worker

### Clover Hardware
- **Device**: Clover Station Duo (Model C505)
- **Features**: Dual screens (merchant + customer facing), built-in receipt printer, full app support
- **Online orders**: Will appear in Clover's Orders app and can auto-print to the built-in printer

### Clover Credentials — ALL SET
- **Public token (PAKMS)**: `f872bb1cf43bbo5c1912191d0fd1f7be` (frontend, in order.html)
- **Private token (API key)**: Set as Cloudflare secret `CLOVER_API_TOKEN`
- **Merchant ID**: `7HCNYBXZS5KW1` — Set as Cloudflare secret `CLOVER_MERCHANT_ID`
- **Integration type**: Hosted iFrame + API/SDK (direct Ecommerce API tokens, no OAuth needed)
- ~~**Mapbox account** — needed for geocoding API token (Chunk 5)~~ DONE

---

## 1. System Architecture

```
                     CUSTOMER BROWSER                        STORE BROWSER
                 ========================               ========================
                 |  menu.html (cart.js)  |               |  store/index.html    |
                 |  order.html (order.js)|               |  store/app.js        |
                 ========================               ========================
                           |                                      |
                           | POST /api/orders                     | GET /api/store/orders
                           | POST /api/orders/:id/pay             | PUT /api/store/orders/:id
                           | POST /api/validate-address           | (polls every 15s)
                           |                                      |
                 ==========================================================
                 |            CLOUDFLARE WORKER (index.js)                 |
                 |                                                        |
                 |   Router:                                              |
                 |     POST /             -> Anthropic proxy (existing)   |
                 |     POST /api/orders   -> createOrder()               |
                 |     POST /api/orders/:id/pay -> chargeOrder()         |
                 |     POST /api/validate-address -> validateAddress()   |
                 |     GET  /api/store/orders -> getStoreOrders()        |
                 |     PUT  /api/store/orders/:id -> updateOrder()       |
                 |     POST /api/store/auth -> storeLogin()              |
                 |     GET  /api/admin/settings -> getSettings()         |
                 |     PUT  /api/admin/settings -> updateSettings()      |
                 |     CRUD /api/admin/specials -> specials management   |
                 |     POST /api/admin/auth -> adminLogin()              |
                 |     Cron (every min) -> fireScheduledOrders()         |
                 ==========================================================
                      |              |              |              |
                 +---------+   +---------+   +-----------+   +----------+
                 |  D1 DB  |   |   KV    |   |  Clover   |   |  Mapbox  |
                 | (SQLite)|   |(sessions)|  |   API     |   |  Geocode |
                 +---------+   +---------+   +-----------+   +----------+
```

### Order Flow (End-to-End)

1. Customer browses `menu.html`, clicks items, customizes via existing modal system
2. `cart.js` stores cart in `localStorage` as a JSON array
3. Customer clicks "Checkout" -> navigates to `order.html`
4. Customer enters name/phone/email, selects pickup or delivery, selects ASAP or scheduled
5. If delivery: frontend calls `POST /api/validate-address` (Mapbox geocoding + Haversine distance)
6. Clover Iframe SDK loads; customer enters card info (card data stays in Clover's iframe)
7. Customer clicks "Place Order" -> frontend calls `POST /api/orders` with cart + customer info
8. Worker **recalculates all prices server-side** from `SERVER_MENU`, generates order number, stores in D1
9. Frontend gets `clv_` token from Clover iframe, calls `POST /api/orders/:id/pay`
10. Worker charges via Clover Ecommerce API, then creates Clover Atomic Order on POS
11. Order appears on Clover POS device in real-time
12. Store dashboard (polling every 15s) picks up new order, plays audible alert
13. Staff taps "Confirm", sets prep time -> customer's status page updates
14. Staff walks order through: preparing -> ready -> picked_up / out_for_delivery -> delivered

---

## 2. Database Schema (Cloudflare D1)

### File: `worker/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS order_number_seq (
    date_key    TEXT PRIMARY KEY,
    last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id                  TEXT PRIMARY KEY,
    order_number        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending_payment',
    order_type          TEXT NOT NULL,
    scheduled_at        TEXT,
    fired               INTEGER NOT NULL DEFAULT 0,
    customer_name       TEXT NOT NULL,
    customer_phone      TEXT NOT NULL,
    customer_email      TEXT,
    delivery_address    TEXT,
    delivery_lat        REAL,
    delivery_lng        REAL,
    delivery_distance_miles REAL,
    subtotal_cents      INTEGER NOT NULL,
    tax_cents           INTEGER NOT NULL,
    delivery_fee_cents  INTEGER NOT NULL DEFAULT 0,
    service_fee_cents   INTEGER NOT NULL DEFAULT 0,
    total_cents         INTEGER NOT NULL,
    clover_order_id     TEXT,
    clover_charge_id    TEXT,
    prep_minutes        INTEGER,
    estimated_ready     TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_scheduled ON orders(scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
    id               TEXT PRIMARY KEY,
    order_id         TEXT NOT NULL REFERENCES orders(id),
    item_name        TEXT NOT NULL,
    item_type        TEXT,
    base_price_cents INTEGER NOT NULL,
    quantity         INTEGER NOT NULL DEFAULT 1,
    customizations   TEXT,
    special_instructions TEXT,
    line_total_cents INTEGER NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS admin_settings (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    ordering_enabled       INTEGER NOT NULL DEFAULT 1,
    delivery_enabled       INTEGER NOT NULL DEFAULT 1,
    delivery_radius_miles  REAL NOT NULL DEFAULT 10.0,
    delivery_minimum_cents INTEGER NOT NULL DEFAULT 5000,
    delivery_fee_cents     INTEGER NOT NULL DEFAULT 0,
    service_fee_enabled    INTEGER NOT NULL DEFAULT 0,
    service_fee_cents      INTEGER NOT NULL DEFAULT 0,
    tax_rate               REAL NOT NULL DEFAULT 0.08625,
    store_pin_hash         TEXT NOT NULL,
    admin_pin_hash         TEXT NOT NULL,
    scheduling_enabled     INTEGER NOT NULL DEFAULT 1,
    max_schedule_days      INTEGER NOT NULL DEFAULT 3,
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS specials (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    day_of_week TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clover_auth (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    merchant_id      TEXT NOT NULL,
    access_token     TEXT NOT NULL,
    refresh_token    TEXT,
    token_expires_at TEXT,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_events (
    id         TEXT PRIMARY KEY,
    order_id   TEXT NOT NULL REFERENCES orders(id),
    event_type TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_order_events_order ON order_events(order_id);
```

### File: `worker/seed.sql`

```sql
-- Default PINs: store="1234", admin="9999" (SHA-256 hashed)
-- SHA-256('1234') = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
-- SHA-256('9999') = 5765cb47e6e22a82216e83ae8dd4d1e3a95ae0bfa4a79b10e0cc928e9e1887f3
INSERT OR IGNORE INTO admin_settings (
    id, ordering_enabled, delivery_enabled,
    delivery_radius_miles, delivery_minimum_cents, delivery_fee_cents,
    service_fee_enabled, service_fee_cents, tax_rate,
    store_pin_hash, admin_pin_hash, scheduling_enabled, max_schedule_days
) VALUES (
    1, 1, 1,
    10.0, 5000, 0,
    0, 0, 0.08625,
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    '5765cb47e6e22a82216e83ae8dd4d1e3a95ae0bfa4a79b10e0cc928e9e1887f3',
    1, 3
);

-- Clover auth placeholder (replaced during setup)
INSERT OR IGNORE INTO clover_auth (
    id, merchant_id, access_token
) VALUES (
    1, 'REPLACE_ME', 'REPLACE_ME'
);
```

---

## 3. API Route Design

### Public Customer Endpoints (no auth)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings/public` | Ordering enabled, delivery settings, fees |
| `GET` | `/api/specials` | Active specials for today |
| `POST` | `/api/orders` | Create order (validates prices server-side) |
| `POST` | `/api/orders/:id/pay` | Charge via Clover token |
| `GET` | `/api/orders/:id` | Order status (customer polling) |
| `POST` | `/api/validate-address` | Geocode + distance check |

### Store Dashboard Endpoints (store PIN auth)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/store/auth` | PIN login -> session token |
| `GET` | `/api/store/orders` | Active orders (pending/confirmed/preparing/ready) |
| `PUT` | `/api/store/orders/:id` | Update status, set prep time |

### Admin Endpoints (admin PIN auth)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/auth` | PIN login -> session token |
| `GET` | `/api/admin/settings` | All settings |
| `PUT` | `/api/admin/settings` | Update settings |
| `POST` | `/api/admin/change-pin` | Change store or admin PIN |
| `GET` | `/api/admin/specials` | All specials (active + inactive) |
| `POST` | `/api/admin/specials` | Create special |
| `PUT` | `/api/admin/specials/:id` | Update special |
| `DELETE` | `/api/admin/specials/:id` | Delete special |

### Internal

| Trigger | Purpose |
|---------|---------|
| Cron (every minute) | Fire scheduled orders to Clover POS when within prep window |
| `POST /` | Existing Anthropic proxy (preserved as-is) |

---

## 4. Frontend Files

### New Files to Create

| File | Purpose |
|------|---------|
| `website/cart.js` | `CartManager` class — localStorage cart, shared by menu + order pages |
| `website/order.html` | Checkout page: cart review, customer info, delivery/pickup, timing, payment |
| `website/order.css` | Checkout styles (same design system) |
| `website/order.js` | Checkout logic: Clover iframe, address validation, order submission, status polling |
| `website/store/index.html` | Store order management dashboard |
| `website/store/style.css` | Store dashboard styles |
| `website/store/app.js` | Store dashboard: polling, alerts, status updates |
| `website/admin/index.html` | Admin settings + specials management |
| `website/admin/style.css` | Admin styles |
| `website/admin/app.js` | Admin: settings CRUD, specials CRUD, PIN management |
| `worker/schema.sql` | D1 database schema |
| `worker/seed.sql` | Default settings seed data |

### Existing Files to Modify

| File | Changes |
|------|---------|
| `worker/index.js` | Rewrite with modular router, preserve existing `POST /` Anthropic proxy |
| `worker/wrangler.toml` | Add D1, KV, cron bindings, env vars |
| `website/menu.html` | Replace `addToOrder()` to use cart, add cart drawer/FAB, add ordering banner |
| `website/index.html` | Change "Order Online" CTA from DoorDash to `/menu.html`, add "Order Direct" card |
| `website/.htaccess` | CSP for Clover iframe, noindex for store/admin |
| `website/robots.txt` | Disallow /store/ and /admin/ |
| `website/sitemap.xml` | Add order.html |

---

## 5. Clover Integration Flow

### One-Time Setup
1. Create Clover developer account -> Create app -> Enable Ecommerce
2. Set permissions: `ORDERS_W`, `PAYMENTS_W`, `INVENTORY_R`
3. Get **PAKMS Key** (frontend, for iframe) and **App ID + Secret** (backend, for API)
4. Complete OAuth v2 flow to get access_token + refresh_token -> store in D1 `clover_auth`

### Payment Flow
1. **Client**: Clover Iframe SDK loads on order.html (`checkout.clover.com/sdk.js`)
2. **Client**: Customer enters card into Clover's secure iframe (card data never touches our server)
3. **Client**: `clover.createToken()` returns `clv_` token
4. **Client -> Worker**: `POST /api/orders/:id/pay` with `cloverToken`
5. **Worker -> Clover**: `POST https://scl.clover.com/v1/charges` with token + amount
6. **Worker -> Clover**: `POST /v3/merchants/{mId}/atomic_order/orders` to create POS order
7. **Worker -> D1**: Update order with `clover_order_id` and `clover_charge_id`

### Token Refresh
Worker checks `clover_auth.token_expires_at` before every API call. If expiring within 5 minutes, refreshes via `POST /oauth/v2/token` with refresh_token. New tokens stored in D1.

### Clover API Endpoints Used

| API | Base URL | Endpoint |
|-----|----------|----------|
| Ecommerce (charges) | `https://scl.clover.com` | `POST /v1/charges` |
| Platform (orders) | `https://api.clover.com` | `POST /v3/merchants/{mId}/atomic_order/orders` |
| OAuth | `https://api.clover.com` | `POST /oauth/v2/token` |
| Iframe SDK | `https://checkout.clover.com` | `sdk.js` (client-side) |

### Processing Fees

| Transaction Type | Fee |
|---|---|
| In-store (card present) | 2.3% + $0.10 |
| **Online (card not present)** | **3.5% + $0.10** |

Example: $15 sandwich online = $0.63 processing fee

---

## 6. Store-Side Order Management

- **URL**: `/store/` (unlisted, noindexed)
- **Auth**: Store PIN -> session token in KV (10hr TTL)
- **Polling**: Every 15 seconds, `GET /api/store/orders`
- **Alert**: Web Audio API (three ascending beeps) when new pending orders detected
- **Order cards**: Color-coded by status, showing customer name, phone, items, total
- **Status flow**: `confirmed` -> `preparing` (set prep time) -> `ready` -> `picked_up` / `out_for_delivery` -> `delivered`
- **Confirm modal**: Tap "Confirm" -> select prep time (10/15/20/30 min) -> order moves to "preparing"
- **Delivery orders**: Additional status step `out_for_delivery` before `delivered`

---

## 7. Delivery System

- **Geocoding**: Mapbox Geocoding API (50K free/month)
- **Distance**: Haversine formula (server-side, no additional API call)
- **Store coordinates**: 40.7580, -72.9393 (461 Station Rd, Bellport)
- **Radius**: 10 miles (configurable in admin)
- **Minimum**: $50 subtotal (configurable in admin)
- **Delivery fee**: Configurable flat fee (default $0, set in admin)
- **Validation**: Both client-side (UX feedback) and server-side (enforcement)
- **Drivers**: Store's own workers handle deliveries

---

## 8. Scheduled Orders

- **Customer selects**: Date (today + N days) and time slot (30-min intervals, 5AM-6:30PM)
- **Payment**: Charged immediately (Clover token is single-use, cannot be stored)
- **Storage**: Order saved in D1 with `scheduled_at` and `fired = 0`
- **Firing**: Cloudflare Cron Trigger (every minute) checks for orders within 20-min prep window
- **When fired**: Creates Clover Atomic Order on POS, sets `fired = 1`, logs event
- **Backup**: Store dashboard polling also triggers `fireScheduledOrders()` as side effect

---

## 9. Admin Interface

- **URL**: `/admin/` (unlisted, noindexed)
- **Auth**: Admin PIN -> session token in KV (10hr TTL)
- **Settings**:
  - Toggle online ordering on/off
  - Toggle delivery on/off
  - Set delivery radius (miles)
  - Set delivery minimum ($)
  - Set delivery fee ($)
  - Toggle service fee on/off
  - Set service fee amount ($)
  - Toggle scheduled ordering on/off
  - Set max schedule days ahead
- **Specials**: Create/edit/delete daily specials (title, description, day-of-week, active toggle)
- **PIN Management**: Change store PIN and admin PIN (requires current PIN)

---

## 10. Security

- **PCI**: SAQ A level — card data handled entirely by Clover Iframe SDK, never touches our server
- **CORS**: Whitelist-based (quickstopsuperdeli.com + localhost origins)
- **Rate limiting**: KV-based counters per IP
  - Orders: 10/min
  - Auth: 5/min
  - Address validation: 20/min
- **Brute force**: 5 failed PIN attempts -> 5 minute lockout per IP
- **PIN hashing**: SHA-256 via Web Crypto API
- **Sessions**: KV with 10hr TTL, prefixed tokens (`sess_` for store, `adm_` for admin)
- **Price validation**: Complete `SERVER_MENU` object in Worker mirrors all menu.html prices; every order recalculated server-side to prevent price tampering
- **CSP**: order.html allows Clover iframe domain only
- **noindex**: store/ and admin/ directories via .htaccess and robots.txt

---

## 11. Development Chunks (Build Order)

**Progress: 9/10 chunks complete (Chunks 1, 2, 3, 4, 5, 6, 7, 8, 9)**
**Next up: Chunk 10 (End-to-End Testing + Deploy)**

```
1 (Worker) ✅ -> 2 (Cart) ✅ -> 4 (Order+Pay) ✅ -> 5 (Delivery) ✅ -> 3 (Checkout) ✅ -> 7 (Admin) ✅ -> 6 (Store) ✅ -> 9 (Polish) ✅ -> 8 (Scheduled) ✅ -> 10 (Deploy)
```

### Infrastructure Setup — COMPLETE
- **D1 Database**: Created and seeded (remote). ID: `0502f30b-bf46-4afe-9b74-f104a0809fc2`
- **KV Namespace**: Created. ID: `ac5b3c6509674a01a5ad9ca86efffaab`
- **Mapbox Token**: Set as Cloudflare secret (`MAPBOX_TOKEN`)
- **Clover Ecommerce**: Public token, private token (CLOVER_API_TOKEN), and Merchant ID (CLOVER_MERCHANT_ID) all set. No OAuth needed.

### Chunk 1: Worker Infrastructure & Database (Large) — DONE
**Files**: `worker/wrangler.toml`, `worker/schema.sql`, `worker/seed.sql`, `worker/index.js`
**Work**: Create D1 database + KV namespace, rewrite worker with modular router skeleton, preserve existing `POST /` Anthropic proxy, add auth/session/rate-limit helper functions, deploy and verify
**Dependencies**: None
**Status**: Complete. Built modular router with 18 API routes, auth/session/rate-limit helpers, SERVER_MENU with full server-side price validation, order number generation (QSD-MMDD-NNN). Stubs in place for Clover payment (Chunk 4), address validation (Chunk 5), and cron (Chunk 8). D1/KV/cron bindings added to wrangler.toml. Schema and seed SQL files created.
**Infrastructure setup**: COMPLETE — D1 created + seeded (local + remote), KV namespace created, Mapbox token set, wrangler.toml IDs updated. Ready to deploy.

### Chunk 2: Cart System (Medium) — DONE
**Files**: `website/cart.js` (new), `website/menu.html` (modify)
**Work**: Create `CartManager` class using localStorage, add cart drawer + floating action button to menu.html, replace `addToOrder()` function to add items to cart instead of redirecting to DoorDash, items without customizations add directly to cart
**Dependencies**: None
**Status**: Complete. CartManager class with localStorage persistence, event system, quantity controls, API payload formatting. menu.html updated with: cart FAB (hidden when empty, shows badge count), slide-in cart drawer with item list/quantities/subtotal/checkout button, toast notifications on add, required-selection validation in modal, direct-to-cart for non-customizable items, nav "Order Now" button now points to /menu.html.

### Chunk 3: Checkout Page (Large) — DONE
**Files**: `website/order.html`, `website/order.css`, `website/order.js` (all new)
**Work**: Cart review with quantities, customer info form (name/phone/email), pickup/delivery toggle with address input, ASAP/scheduled toggle with date/time selectors, order summary with price breakdown (subtotal/tax/fees/total), Clover iframe container, place order button, confirmation screen with status polling
**Dependencies**: Chunk 2 (cart.js), Chunk 1 (settings API)
**Status**: Complete. Full checkout page with 6 numbered sections: (1) cart review with item details/prices, (2) customer info form with validation and localStorage persistence, (3) pickup/delivery toggle with live Mapbox address validation, delivery minimum/radius display, (4) ASAP/scheduled timing with dynamic date/time selectors (30-min intervals, 5AM-6:30PM, 45-min buffer for today), (5) order summary with subtotal/tax/delivery fee/service fee/total auto-calculated from settings, (6) Clover payment iframe placeholder. Place Order button calls POST /api/orders, then shows confirmation screen with live status polling (10s interval) and order progress tracker. Customer info saved to localStorage for repeat orders. Fully responsive mobile-first design matching the retro-modern brutal design system. Clover iframe integration ready — just needs Clover SDK script + credentials.

### Chunk 4: Order API + Clover Integration (Large) — PARTIALLY DONE
**Files**: `worker/index.js` (add routes + Clover functions)
**Work**: `POST /api/orders` with complete server-side price validation using `SERVER_MENU` object, `POST /api/orders/:id/pay` with Clover charge + atomic order creation, `GET /api/orders/:id` for status polling, Clover OAuth v2 token refresh logic, order number generation (QSD-MMDD-NNN format)
**Dependencies**: Chunk 1
**Status**: Order API portion complete (built during Chunk 1). `POST /api/orders` fully implements server-side price recalculation from SERVER_MENU, hero upcharges, customization extras, coffee size pricing, delivery minimum enforcement, tax/fee calculation, and QSD-MMDD-NNN order number generation. `GET /api/orders/:id` returns order status for customer polling. Remaining Clover-specific work:
- `POST /api/orders/:id/pay` — stub in place, needs Clover Ecommerce charge + atomic order creation
**Status update**: COMPLETE. Using Clover Ecommerce API tokens (no OAuth needed). `POST /api/orders/:id/pay` charges via `https://scl.clover.com/v1/charges` with the Clover token from the iframe, then creates an atomic order on the POS via `https://api.clover.com/v3/merchants/{mId}/atomic_order/orders`. Frontend uses Clover Hosted iFrame SDK (`checkout.clover.com/sdk.js`) with public token `f872bb1cf43bbo5c1912191d0fd1f7be` to collect card data securely. Card number, expiry, CVV, and ZIP fields render in Clover's iframe — card data never touches our server (SAQ A compliant).

### Chunk 5: Delivery Validation (Small) — DONE
**Files**: `worker/index.js` (filled in stub)
**Work**: `POST /api/validate-address` handler with Mapbox geocoding + Haversine distance calculation, delivery minimum enforcement, set `MAPBOX_TOKEN` as Cloudflare secret
**Dependencies**: Chunk 1
**Status**: Complete. Replaced the 501 stub with full implementation: rate-limited (20/min per IP), Mapbox Geocoding v5 API call (US addresses only, type=address), Haversine distance formula (store coords 40.7580, -72.9393), returns `{ valid, formatted_address, lat, lng, distance_miles, radius_miles, delivery_minimum_cents, reason }`. Checks delivery_enabled and delivery_radius_miles from admin_settings. Graceful errors for missing MAPBOX_TOKEN, geocoding failures, and unrecognized addresses.
**Setup**: COMPLETE — `MAPBOX_TOKEN` set as Cloudflare secret.

### Chunk 6: Store Dashboard (Large) — DONE
**Files**: `website/store/index.html`, `website/store/style.css`, `website/store/app.js` (all new)
**Work**: PIN login screen, order list with 15-second polling, audible alert via Web Audio API (three ascending beeps), confirm modal with prep time selection (10/15/20/30 min), status transition buttons, order card rendering with color-coded borders
**Dependencies**: Chunk 1 (auth), Chunk 4 (orders in DB)
**Status**: Complete. Full store-side order management dashboard at `/store/`. Features: PIN login (store PIN, sessionStorage-based), auto-polling every 15 seconds via `GET /api/store/orders`, Web Audio API alert (C5-E5-G5 ascending beeps) on new orders, mute toggle. Filter tabs (All Active / Pending / Confirmed / Preparing / Ready) with live counts. Order cards show: order number, type badge (pickup/delivery), customer name+phone (clickable tel: link), delivery address, all items with customizations and special instructions, total. Color-coded left border by status (orange=pending, blue=confirmed, yellow=preparing, green=ready, purple=delivering). Confirm modal with 4 prep time options (10/15/20/30 min). Full status workflow buttons: Confirm→Start Preparing→Mark Ready→Picked Up (or Out for Delivery→Delivered for delivery orders). Cancel button on pending/confirmed. Cards sorted by status priority then newest first. Responsive mobile layout.

### Chunk 7: Admin Interface (Medium) — DONE
**Files**: `website/admin/index.html`, `website/admin/style.css`, `website/admin/app.js` (all new)
**Work**: PIN login, settings form with toggle switches and number inputs, specials CRUD with create/edit/delete, PIN change for store and admin
**Dependencies**: Chunk 1
**Status**: Complete. Admin panel at `/admin/` with PIN login (admin PIN, sessionStorage-based). Three tabs: (1) Settings — toggle switches for ordering, delivery, scheduling, service fee + number inputs for radius, minimums, fees, tax rate, max schedule days. Converts between dollars/cents and percentage/decimal for display. Save button with status feedback. (2) Specials — lists all specials with title, description, day-of-week tag, active/inactive status. Create/Edit modal with title, description, day dropdown, active checkbox. Delete with confirmation. (3) PIN Management — change store PIN and admin PIN, each requiring current PIN verification. Toast notifications on all actions. Auto-logout on 401 responses. noindex meta tag. Responsive layout.

### Chunk 8: Scheduled Orders & Cron (Medium) — DONE
**Files**: `worker/index.js` (add `scheduled()` handler)
**Work**: Cloudflare Cron Trigger (every minute) queries unfired scheduled orders within 20-minute prep window, creates Clover atomic orders on POS, sets `fired = 1`, logs events. Backup firing via store dashboard polling.
**Dependencies**: Chunk 4, Chunk 6
**Status**: Complete. Cron handler queries `orders` table for confirmed scheduled orders where `scheduled_at <= now + 20min` and `fired = 0`. For each, creates a Clover atomic order on POS (reuses `createCloverAtomicOrder()`), sets `fired = 1`, and logs events. Continues processing remaining orders if one fails. Graceful handling when Clover credentials not set.

### Chunk 9: Homepage & Polish (Small) — DONE
**Files**: `website/index.html`, `website/.htaccess`, `website/robots.txt`, `website/sitemap.xml`
**Work**: Update hero CTA and nav button from DoorDash to `/order.html`, add "Order Direct" card in delivery section alongside DoorDash/GrubHub, add CSP headers for Clover iframe, add noindex for store/admin, update sitemap
**Dependencies**: Chunk 2
**Status**: Complete. Nav "Order Now" button and hero "Order Online" CTA now link to `/order.html` instead of DoorDash. Delivery section has new "Order Direct" card (first position, red border, "No Fees" badge) alongside DoorDash and GrubHub. `.htaccess` updated with Content-Security-Policy allowing Clover iframe, Google Maps, Mapbox API, and Cloudflare worker. `robots.txt` disallows `/store/`, `/admin/`, and `/dashboard/`. `sitemap.xml` includes `/order.html`. Footer copyright updated to 2026.

### Chunk 10: End-to-End Testing & Deployment (Medium)
**Work**: Full flow testing (pickup, delivery, scheduled), edge cases (empty cart, under-minimum delivery, invalid address, rapid clicks), Clover sandbox to production switch, upload all files to Hostinger, deploy Worker
**Dependencies**: All chunks

---

## Verification Plan

1. **Cart**: Add items from menu, verify localStorage, change quantities, remove items, persist across refresh
2. **Checkout**: Navigate from cart, fill form, toggle pickup/delivery, toggle ASAP/scheduled
3. **Delivery**: Valid Bellport address (passes), Manhattan address (rejected), under-$50 subtotal (warned)
4. **Payment (sandbox)**: Enter test card in Clover iframe, place order, verify charge + order on Clover POS
5. **Store dashboard**: Login with PIN, see new order arrive with chime, confirm with prep time, walk through all statuses
6. **Scheduled order**: Place order for 20 min from now, verify payment charged but not on POS, wait for cron, verify appears on POS
7. **Admin**: Toggle ordering off (menu shows banner), toggle on, create special (shows on menu), change fees, change PIN
8. **Security**: Tampered prices rejected, rate limits enforced, wrong PIN locked out after 5 attempts

---

## Cost Summary

| Item | Cost |
|------|------|
| Clover processing (online) | 3.5% + $0.10 per transaction |
| Cloudflare Worker | Free tier (100K req/day) |
| Cloudflare D1 | Free tier (5M reads/day, 100K writes/day) |
| Cloudflare KV | Free tier (100K reads/day, 1K writes/day) |
| Mapbox Geocoding | Free tier (50K req/month) |
| Hostinger hosting | Existing plan |
| **Monthly platform fees** | **$0** |

-- Quickstop Super Deli — D1 Database Schema
-- Used by Cloudflare Worker for online ordering system

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

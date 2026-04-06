-- Default PINs: store="1234", admin="9999" (SHA-256 hashed)
-- SHA-256('1234') = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
-- SHA-256('9999') = 888df25ae35772424a560c7152a1de794440e0ea5cfee62828333a456a506e05
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
    '888df25ae35772424a560c7152a1de794440e0ea5cfee62828333a456a506e05',
    1, 3
);

-- Clover auth placeholder (replaced during setup)
INSERT OR IGNORE INTO clover_auth (
    id, merchant_id, access_token
) VALUES (
    1, 'REPLACE_ME', 'REPLACE_ME'
);

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

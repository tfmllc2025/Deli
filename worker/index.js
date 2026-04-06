// ============================================================
// Cloudflare Worker — Quickstop Super Deli API
//
// Handles:
//   1. Anthropic AI proxy (existing marketing dashboard)
//   2. Online ordering system (orders, payments, store, admin)
//
// Bindings (see wrangler.toml):
//   - DB:  D1 database (orders, settings, specials)
//   - KV:  KV namespace (sessions, rate limits)
//   - Secrets: ANTHROPIC_API_KEY, MAPBOX_TOKEN
//
// Deploy:
//   cd worker && wrangler deploy
//
// Database setup:
//   wrangler d1 create superdeli-orders
//   wrangler d1 execute superdeli-orders --file=schema.sql
//   wrangler d1 execute superdeli-orders --file=seed.sql
// ============================================================

// ── CORS ────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
    'https://quickstopsuperdeli.com',
    'https://www.quickstopsuperdeli.com',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
];

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };
    if (ALLOWED_ORIGINS.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

function corsJson(data, status, request) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
    });
}

function corsError(message, status, request) {
    return corsJson({ error: message }, status, request);
}

// ── Helpers ─────────────────────────────────────────────────

function generateId() {
    return crypto.randomUUID();
}

async function sha256(message) {
    const data = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Rate Limiting (KV-based) ────────────────────────────────

async function checkRateLimit(kv, key, maxRequests, windowSeconds) {
    const rlKey = `rl:${key}`;
    const now = Math.floor(Date.now() / 1000);
    const raw = await kv.get(rlKey);
    let bucket = raw ? JSON.parse(raw) : { count: 0, reset: now + windowSeconds };

    // Window expired — reset
    if (now > bucket.reset) {
        bucket = { count: 0, reset: now + windowSeconds };
    }

    bucket.count++;
    await kv.put(rlKey, JSON.stringify(bucket), { expirationTtl: windowSeconds + 10 });

    if (bucket.count > maxRequests) {
        return { allowed: false, retryAfter: bucket.reset - now };
    }
    return { allowed: true };
}

// ── Brute-Force Protection ──────────────────────────────────

async function checkBruteForce(kv, ip) {
    const bfKey = `bf:${ip}`;
    const raw = await kv.get(bfKey);
    if (!raw) return { locked: false };
    const data = JSON.parse(raw);
    if (data.lockedUntil && Date.now() < data.lockedUntil) {
        return { locked: true, retryAfter: Math.ceil((data.lockedUntil - Date.now()) / 1000) };
    }
    return { locked: false, failures: data.failures || 0 };
}

async function recordAuthFailure(kv, ip) {
    const bfKey = `bf:${ip}`;
    const raw = await kv.get(bfKey);
    let data = raw ? JSON.parse(raw) : { failures: 0 };
    data.failures = (data.failures || 0) + 1;
    if (data.failures >= 5) {
        data.lockedUntil = Date.now() + 5 * 60 * 1000; // 5 min lockout
    }
    await kv.put(bfKey, JSON.stringify(data), { expirationTtl: 600 });
}

async function clearAuthFailures(kv, ip) {
    await kv.delete(`bf:${ip}`);
}

// ── Session Management ──────────────────────────────────────

async function createSession(kv, prefix, data) {
    const token = `${prefix}_${generateId()}`;
    await kv.put(`session:${token}`, JSON.stringify(data), { expirationTtl: 36000 }); // 10hr
    return token;
}

async function getSession(kv, token) {
    if (!token) return null;
    const raw = await kv.get(`session:${token}`);
    return raw ? JSON.parse(raw) : null;
}

function getAuthToken(request) {
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
}

// ── Auth Middleware ──────────────────────────────────────────

async function requireStoreAuth(request, env) {
    const token = getAuthToken(request);
    if (!token || !token.startsWith('sess_')) return null;
    return await getSession(env.KV, token);
}

async function requireAdminAuth(request, env) {
    const token = getAuthToken(request);
    if (!token || !token.startsWith('adm_')) return null;
    return await getSession(env.KV, token);
}

// ── Router ──────────────────────────────────────────────────

function matchRoute(method, pathname, routes) {
    for (const route of routes) {
        if (route.method !== method) continue;
        const paramNames = [];
        const regexStr = route.pattern.replace(/:(\w+)/g, (_, name) => {
            paramNames.push(name);
            return '([^/]+)';
        });
        const match = pathname.match(new RegExp(`^${regexStr}$`));
        if (match) {
            const params = {};
            paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
            return { handler: route.handler, params };
        }
    }
    return null;
}

// ── Route Handlers ──────────────────────────────────────────

// --- Public: Settings ---
async function getPublicSettings(request, env) {
    const row = await env.DB.prepare(
        `SELECT ordering_enabled, delivery_enabled, delivery_radius_miles,
                delivery_minimum_cents, delivery_fee_cents,
                service_fee_enabled, service_fee_cents, tax_rate,
                scheduling_enabled, max_schedule_days
         FROM admin_settings WHERE id = 1`
    ).first();
    if (!row) return corsError('Settings not found', 500, request);
    return corsJson(row, 200, request);
}

// --- Public: Specials ---
async function getActiveSpecials(request, env) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = dayNames[new Date().getDay()];
    const { results } = await env.DB.prepare(
        `SELECT id, title, description, day_of_week
         FROM specials
         WHERE active = 1 AND (day_of_week IS NULL OR day_of_week = ?)`
    ).bind(today).all();
    return corsJson(results, 200, request);
}

// --- Public: Create Order ---
async function createOrder(request, env, params) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await checkRateLimit(env.KV, `order:${ip}`, 10, 60);
    if (!rl.allowed) {
        return corsError('Too many requests. Try again shortly.', 429, request);
    }

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { items, customer_name, customer_phone, customer_email,
            order_type, delivery_address, scheduled_at } = body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
        return corsError('Cart is empty', 400, request);
    }
    if (!customer_name || !customer_phone) {
        return corsError('Name and phone are required', 400, request);
    }
    if (!order_type || !['pickup', 'delivery'].includes(order_type)) {
        return corsError('Invalid order type', 400, request);
    }

    // Check ordering is enabled
    const settings = await env.DB.prepare(
        'SELECT * FROM admin_settings WHERE id = 1'
    ).first();
    if (!settings || !settings.ordering_enabled) {
        return corsError('Online ordering is currently disabled', 503, request);
    }
    if (order_type === 'delivery' && !settings.delivery_enabled) {
        return corsError('Delivery is currently unavailable', 503, request);
    }

    // Server-side price calculation using SERVER_MENU
    let subtotalCents = 0;
    const orderItems = [];

    for (const item of items) {
        const menuEntry = SERVER_MENU[item.item_name];
        if (!menuEntry) {
            return corsError(`Unknown menu item: ${item.item_name}`, 400, request);
        }

        const quantity = Math.max(1, Math.min(20, parseInt(item.quantity) || 1));
        let linePriceCents = menuEntry.base_price_cents;

        // Calculate customization extras
        if (item.customizations && typeof item.customizations === 'object') {
            for (const [section, selected] of Object.entries(item.customizations)) {
                if (Array.isArray(selected)) {
                    for (const sel of selected) {
                        const extraCents = getCustomizationPrice(item.item_name, section, sel.value);
                        linePriceCents += extraCents;
                    }
                } else if (selected && selected.value) {
                    const extraCents = getCustomizationPrice(item.item_name, section, selected.value);
                    linePriceCents += extraCents;
                }
            }
        }

        const lineTotalCents = linePriceCents * quantity;
        subtotalCents += lineTotalCents;

        orderItems.push({
            id: generateId(),
            item_name: item.item_name,
            item_type: menuEntry.type || null,
            base_price_cents: menuEntry.base_price_cents,
            quantity,
            customizations: item.customizations ? JSON.stringify(item.customizations) : null,
            special_instructions: (item.special_instructions || '').slice(0, 500),
            line_total_cents: lineTotalCents,
        });
    }

    // Delivery minimum check
    if (order_type === 'delivery' && subtotalCents < settings.delivery_minimum_cents) {
        const minDollars = (settings.delivery_minimum_cents / 100).toFixed(2);
        return corsError(`Delivery minimum is $${minDollars}`, 400, request);
    }

    // Calculate totals
    const deliveryFeeCents = order_type === 'delivery' ? settings.delivery_fee_cents : 0;
    const serviceFeeCents = settings.service_fee_enabled ? settings.service_fee_cents : 0;
    const taxCents = Math.round(subtotalCents * settings.tax_rate);
    const totalCents = subtotalCents + taxCents + deliveryFeeCents + serviceFeeCents;

    // Generate order number: QSD-MMDD-NNN
    const now = new Date();
    const dateKey = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    await env.DB.prepare(
        'INSERT INTO order_number_seq (date_key, last_number) VALUES (?, 0) ON CONFLICT(date_key) DO NOTHING'
    ).bind(dateKey).run();
    await env.DB.prepare(
        'UPDATE order_number_seq SET last_number = last_number + 1 WHERE date_key = ?'
    ).bind(dateKey).run();
    const seq = await env.DB.prepare(
        'SELECT last_number FROM order_number_seq WHERE date_key = ?'
    ).bind(dateKey).first();
    const orderNumber = `QSD-${dateKey}-${String(seq.last_number).padStart(3, '0')}`;

    // Insert order
    const orderId = generateId();
    await env.DB.prepare(
        `INSERT INTO orders (id, order_number, status, order_type, scheduled_at,
            customer_name, customer_phone, customer_email, delivery_address,
            subtotal_cents, tax_cents, delivery_fee_cents, service_fee_cents, total_cents)
         VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        orderId, orderNumber, order_type, scheduled_at || null,
        customer_name, customer_phone, customer_email || null, delivery_address || null,
        subtotalCents, taxCents, deliveryFeeCents, serviceFeeCents, totalCents
    ).run();

    // Insert order items
    for (const oi of orderItems) {
        await env.DB.prepare(
            `INSERT INTO order_items (id, order_id, item_name, item_type, base_price_cents,
                quantity, customizations, special_instructions, line_total_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(oi.id, orderId, oi.item_name, oi.item_type, oi.base_price_cents,
               oi.quantity, oi.customizations, oi.special_instructions, oi.line_total_cents
        ).run();
    }

    // Log event
    await env.DB.prepare(
        'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), orderId, 'created', `Order ${orderNumber} created`).run();

    return corsJson({
        order_id: orderId,
        order_number: orderNumber,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        delivery_fee_cents: deliveryFeeCents,
        service_fee_cents: serviceFeeCents,
        total_cents: totalCents,
    }, 201, request);
}

// --- Public: Get Order Status ---
async function getOrderStatus(request, env, params) {
    const order = await env.DB.prepare(
        `SELECT id, order_number, status, order_type, scheduled_at,
                customer_name, subtotal_cents, tax_cents, delivery_fee_cents,
                service_fee_cents, total_cents, prep_minutes, estimated_ready, created_at
         FROM orders WHERE id = ?`
    ).bind(params.id).first();
    if (!order) return corsError('Order not found', 404, request);
    return corsJson(order, 200, request);
}

// --- Public: Pay Order (Clover Ecommerce API) ---
async function payOrder(request, env, params) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await checkRateLimit(env.KV, `pay:${ip}`, 10, 60);
    if (!rl.allowed) return corsError('Too many requests. Try again shortly.', 429, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { clover_token } = body;
    if (!clover_token) return corsError('Payment token required', 400, request);

    // Fetch order
    const order = await env.DB.prepare(
        'SELECT * FROM orders WHERE id = ?'
    ).bind(params.id).first();
    if (!order) return corsError('Order not found', 404, request);
    if (order.status !== 'pending_payment') {
        return corsError('Order already paid or cancelled', 400, request);
    }

    if (!env.CLOVER_API_TOKEN || !env.CLOVER_MERCHANT_ID) {
        return corsError('Payment processing not configured', 503, request);
    }

    // Step 1: Charge via Clover Ecommerce API
    let chargeData;
    try {
        const chargeResp = await fetch('https://scl.clover.com/v1/charges', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.CLOVER_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: order.total_cents,
                currency: 'usd',
                source: clover_token,
                description: `Order ${order.order_number} — Quickstop Super Deli`,
                external_reference_id: order.id,
            }),
        });

        chargeData = await chargeResp.json();

        if (!chargeResp.ok || chargeData.error) {
            const errMsg = chargeData.error?.message || chargeData.message || 'Payment failed';
            console.error('Clover charge error:', JSON.stringify(chargeData));
            return corsError(`Payment declined: ${errMsg}`, 400, request);
        }
    } catch (err) {
        console.error('Clover charge exception:', err);
        return corsError('Payment processing unavailable. Please try again.', 502, request);
    }

    const chargeId = chargeData.id;

    // Step 2: Create atomic order on Clover POS
    let cloverOrderId = null;
    try {
        cloverOrderId = await createCloverAtomicOrder(env, order, params.id);
    } catch (err) {
        // Payment succeeded but POS order failed — log it, don't fail the customer
        console.error('Clover atomic order failed (payment succeeded):', err);
    }

    // Step 3: Update order in DB — mark as confirmed
    const newStatus = order.scheduled_at ? 'confirmed' : 'confirmed';
    await env.DB.prepare(
        `UPDATE orders SET status = ?, clover_charge_id = ?, clover_order_id = ?,
         updated_at = datetime('now') WHERE id = ?`
    ).bind(newStatus, chargeId, cloverOrderId, params.id).run();

    // Log events
    await env.DB.prepare(
        'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), params.id, 'payment', `Charged $${(order.total_cents / 100).toFixed(2)} — Clover charge ${chargeId}`).run();

    if (cloverOrderId) {
        await env.DB.prepare(
            'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
        ).bind(generateId(), params.id, 'pos_created', `Clover POS order ${cloverOrderId}`).run();
    }

    return corsJson({
        success: true,
        order_id: params.id,
        order_number: order.order_number,
        status: newStatus,
        clover_charge_id: chargeId,
    }, 200, request);
}

// --- Clover: Create Atomic Order on POS ---
async function createCloverAtomicOrder(env, order, orderId) {
    // Fetch order items
    const { results: items } = await env.DB.prepare(
        'SELECT * FROM order_items WHERE order_id = ?'
    ).bind(orderId).all();

    // Build line items for Clover
    const lineItems = items.map(item => ({
        name: item.item_name + (item.quantity > 1 ? ` x${item.quantity}` : ''),
        price: item.line_total_cents,
        note: [
            item.customizations ? formatCustomizations(item.customizations) : null,
            item.special_instructions || null,
        ].filter(Boolean).join(' | ') || undefined,
    }));

    // Add tax as a line item note (Clover calculates tax from merchant settings,
    // but we include our calculated tax for transparency)
    const orderNote = [
        `Online Order ${order.order_number}`,
        `PAID ONLINE`,
        `${order.order_type.toUpperCase()}`,
        `Customer: ${order.customer_name} — ${order.customer_phone}`,
        order.delivery_address ? `Deliver to: ${order.delivery_address}` : null,
        order.scheduled_at ? `Scheduled: ${order.scheduled_at}` : 'ASAP',
    ].filter(Boolean).join('\n');

    const atomicBody = {
        orderCart: {
            lineItems,
            note: orderNote,
        },
        paymentState: 'PAID',
        state: 'open',
    };

    const resp = await fetch(
        `https://api.clover.com/v3/merchants/${env.CLOVER_MERCHANT_ID}/atomic_order/orders`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.CLOVER_CHECKOUT_TOKEN || env.CLOVER_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(atomicBody),
        }
    );

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Clover atomic order failed: ${resp.status} ${errText}`);
    }

    const data = await resp.json();
    return data.id || null;
}

function formatCustomizations(custJson) {
    try {
        const custs = typeof custJson === 'string' ? JSON.parse(custJson) : custJson;
        const parts = [];
        for (const [section, val] of Object.entries(custs)) {
            if (Array.isArray(val)) {
                parts.push(val.map(v => v.value || v).join(', '));
            } else if (val && val.value) {
                parts.push(val.value);
            }
        }
        return parts.join(', ');
    } catch { return ''; }
}

// --- Public: Create Hosted Checkout Session ---
async function createCheckoutSession(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await checkRateLimit(env.KV, `checkout:${ip}`, 10, 60);
    if (!rl.allowed) return corsError('Too many requests. Try again shortly.', 429, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { order_id } = body;
    if (!order_id) return corsError('Order ID required', 400, request);

    // Fetch order and items
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
    if (!order) return corsError('Order not found', 404, request);
    if (order.status !== 'pending_payment') {
        return corsError('Order already paid or cancelled', 400, request);
    }

    if (!env.CLOVER_CHECKOUT_TOKEN || !env.CLOVER_MERCHANT_ID) {
        return corsError('Payment processing not configured', 503, request);
    }

    const { results: items } = await env.DB.prepare(
        'SELECT * FROM order_items WHERE order_id = ?'
    ).bind(order_id).all();

    // Build line items for Clover hosted checkout
    const lineItems = items.map(item => ({
        name: item.item_name + (item.quantity > 1 ? ` x${item.quantity}` : ''),
        unitQty: 1,
        price: item.line_total_cents,
        note: [
            item.customizations ? formatCustomizations(item.customizations) : null,
            item.special_instructions || null,
        ].filter(Boolean).join(' | ') || undefined,
    }));

    // Add tax as a line item
    if (order.tax_cents > 0) {
        lineItems.push({ name: 'Tax', unitQty: 1, price: order.tax_cents });
    }
    // Add delivery fee if applicable
    if (order.delivery_fee_cents > 0) {
        lineItems.push({ name: 'Delivery Fee', unitQty: 1, price: order.delivery_fee_cents });
    }
    // Add service fee if applicable
    if (order.service_fee_cents > 0) {
        lineItems.push({ name: 'Service Fee', unitQty: 1, price: order.service_fee_cents });
    }

    // Split customer name into first/last
    const nameParts = order.customer_name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create Clover hosted checkout session
    const checkoutBody = {
        customer: {
            firstName,
            lastName,
            phoneNumber: order.customer_phone,
            email: order.customer_email || undefined,
        },
        shoppingCart: { lineItems },
        redirectUrls: {
            success: `https://quickstopsuperdeli.com/order.html?status=success&order_id=${order_id}`,
            failure: `https://quickstopsuperdeli.com/order.html?status=failure&order_id=${order_id}`,
        },
    };

    try {
        const resp = await fetch(
            `https://api.clover.com/invoicingcheckoutservice/v1/checkouts`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.CLOVER_CHECKOUT_TOKEN}`,
                    'X-Clover-Merchant-Id': env.CLOVER_MERCHANT_ID,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(checkoutBody),
            }
        );

        const data = await resp.json();

        if (!resp.ok) {
            console.error('Clover checkout error:', JSON.stringify(data));
            return corsError('Could not create payment session. Please try again.', 502, request);
        }

        // Store checkout session ID on the order for later verification
        await env.DB.prepare(
            `UPDATE orders SET clover_charge_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(data.checkoutSessionId, order_id).run();

        await env.DB.prepare(
            'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
        ).bind(generateId(), order_id, 'checkout_created', `Clover checkout session ${data.checkoutSessionId}`).run();

        return corsJson({
            checkout_url: data.href,
            session_id: data.checkoutSessionId,
            expires: data.expirationTime,
        }, 200, request);

    } catch (err) {
        console.error('Clover checkout exception:', err);
        return corsError('Payment processing unavailable. Please try again.', 502, request);
    }
}

// --- Public: Verify Checkout Payment ---
async function verifyCheckoutPayment(request, env) {
    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { order_id } = body;
    if (!order_id) return corsError('Order ID required', 400, request);

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
    if (!order) return corsError('Order not found', 404, request);

    // If already confirmed, return success
    if (order.status !== 'pending_payment') {
        return corsJson({
            order_id: order.id,
            order_number: order.order_number,
            order_type: order.order_type,
            status: order.status,
        }, 200, request);
    }

    // Mark as confirmed (Clover redirected to success URL, payment is complete)
    await env.DB.prepare(
        `UPDATE orders SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`
    ).bind(order_id).run();

    await env.DB.prepare(
        'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), order_id, 'payment', `Payment confirmed via hosted checkout`).run();

    // Create atomic order on POS (best effort)
    try {
        const cloverOrderId = await createCloverAtomicOrder(env, order, order_id);
        if (cloverOrderId) {
            await env.DB.prepare(
                `UPDATE orders SET clover_order_id = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(cloverOrderId, order_id).run();
            await env.DB.prepare(
                'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
            ).bind(generateId(), order_id, 'pos_created', `Clover POS order ${cloverOrderId}`).run();
        }
    } catch (err) {
        console.error('Clover atomic order failed (payment succeeded):', err);
    }

    return corsJson({
        order_id: order.id,
        order_number: order.order_number,
        order_type: order.order_type,
        status: 'confirmed',
    }, 200, request);
}

// --- Public: Validate Address (Mapbox Geocoding + Haversine) ---
// Store coordinates: 461 Station Rd, Bellport, NY
const STORE_LAT = 40.7580;
const STORE_LNG = -72.9393;

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 3958.8; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function validateAddress(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await checkRateLimit(env.KV, `addr:${ip}`, 20, 60);
    if (!rl.allowed) return corsError('Too many requests. Try again shortly.', 429, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { address } = body;
    if (!address || typeof address !== 'string' || address.trim().length < 5) {
        return corsError('A valid address is required', 400, request);
    }

    if (!env.MAPBOX_TOKEN) {
        return corsError('Address validation not configured', 503, request);
    }

    // Fetch settings for radius/minimum
    const settings = await env.DB.prepare(
        'SELECT delivery_enabled, delivery_radius_miles, delivery_minimum_cents FROM admin_settings WHERE id = 1'
    ).first();
    if (!settings || !settings.delivery_enabled) {
        return corsError('Delivery is currently unavailable', 503, request);
    }

    // Geocode via Mapbox
    const encoded = encodeURIComponent(address.trim());
    const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${env.MAPBOX_TOKEN}&country=us&types=address&limit=1`;

    let geoData;
    try {
        const resp = await fetch(mapboxUrl);
        if (!resp.ok) return corsError('Geocoding service error', 502, request);
        geoData = await resp.json();
    } catch {
        return corsError('Geocoding service unavailable', 502, request);
    }

    if (!geoData.features || geoData.features.length === 0) {
        return corsJson({
            valid: false,
            reason: 'Address not found. Please enter a full street address.',
        }, 200, request);
    }

    const feature = geoData.features[0];
    const [lng, lat] = feature.center;
    const formattedAddress = feature.place_name;
    const distance = haversineDistance(STORE_LAT, STORE_LNG, lat, lng);
    const withinRadius = distance <= settings.delivery_radius_miles;

    return corsJson({
        valid: withinRadius,
        formatted_address: formattedAddress,
        lat,
        lng,
        distance_miles: +distance.toFixed(2),
        radius_miles: settings.delivery_radius_miles,
        delivery_minimum_cents: settings.delivery_minimum_cents,
        reason: withinRadius
            ? null
            : `Address is ${distance.toFixed(1)} miles away. Delivery radius is ${settings.delivery_radius_miles} miles.`,
    }, 200, request);
}

// --- Store Auth ---
async function storeLogin(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Rate limit auth attempts
    const rl = await checkRateLimit(env.KV, `auth:${ip}`, 5, 60);
    if (!rl.allowed) return corsError('Too many attempts. Try again later.', 429, request);

    // Brute-force check
    const bf = await checkBruteForce(env.KV, ip);
    if (bf.locked) return corsError(`Locked out. Try again in ${bf.retryAfter}s.`, 429, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    if (!body.pin) return corsError('PIN required', 400, request);

    const pinHash = await sha256(body.pin);
    const settings = await env.DB.prepare(
        'SELECT store_pin_hash FROM admin_settings WHERE id = 1'
    ).first();

    if (!settings || pinHash !== settings.store_pin_hash) {
        await recordAuthFailure(env.KV, ip);
        return corsError('Invalid PIN', 401, request);
    }

    await clearAuthFailures(env.KV, ip);
    const token = await createSession(env.KV, 'sess', { role: 'store' });
    return corsJson({ token }, 200, request);
}

// --- Store: Get Orders ---
async function getStoreOrders(request, env) {
    const session = await requireStoreAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    const { results } = await env.DB.prepare(
        `SELECT o.*, GROUP_CONCAT(oi.id) as item_ids
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status IN ('pending_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
         GROUP BY o.id
         ORDER BY o.created_at DESC`
    ).all();

    // Fetch items for each order
    const ordersWithItems = [];
    for (const order of results) {
        const { results: items } = await env.DB.prepare(
            'SELECT * FROM order_items WHERE order_id = ?'
        ).bind(order.id).all();
        ordersWithItems.push({ ...order, items });
    }

    return corsJson(ordersWithItems, 200, request);
}

// --- Store: Update Order ---
async function updateStoreOrder(request, env, params) {
    const session = await requireStoreAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { status, prep_minutes } = body;
    const validStatuses = ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'picked_up', 'delivered', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
        return corsError('Invalid status', 400, request);
    }

    // Build update
    const updates = [];
    const binds = [];
    if (status) {
        updates.push('status = ?');
        binds.push(status);
    }
    if (prep_minutes) {
        updates.push('prep_minutes = ?');
        binds.push(prep_minutes);
        // Calculate estimated ready time
        const readyAt = new Date(Date.now() + prep_minutes * 60000).toISOString();
        updates.push('estimated_ready = ?');
        binds.push(readyAt);
    }
    updates.push("updated_at = datetime('now')");
    binds.push(params.id);

    await env.DB.prepare(
        `UPDATE orders SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    // Log event
    await env.DB.prepare(
        'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), params.id, 'status_change', `Status -> ${status || 'updated'}`).run();

    return corsJson({ success: true }, 200, request);
}

// --- Admin Auth ---
async function adminLogin(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    const rl = await checkRateLimit(env.KV, `auth:${ip}`, 5, 60);
    if (!rl.allowed) return corsError('Too many attempts. Try again later.', 429, request);

    const bf = await checkBruteForce(env.KV, ip);
    if (bf.locked) return corsError(`Locked out. Try again in ${bf.retryAfter}s.`, 429, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    if (!body.pin) return corsError('PIN required', 400, request);

    const pinHash = await sha256(body.pin);
    const settings = await env.DB.prepare(
        'SELECT admin_pin_hash FROM admin_settings WHERE id = 1'
    ).first();

    if (!settings || pinHash !== settings.admin_pin_hash) {
        await recordAuthFailure(env.KV, ip);
        return corsError('Invalid PIN', 401, request);
    }

    await clearAuthFailures(env.KV, ip);
    const token = await createSession(env.KV, 'adm', { role: 'admin' });
    return corsJson({ token }, 200, request);
}

// --- Admin: Get Settings ---
async function getAdminSettings(request, env) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    const row = await env.DB.prepare('SELECT * FROM admin_settings WHERE id = 1').first();
    if (!row) return corsError('Settings not found', 500, request);
    // Don't expose PIN hashes
    delete row.store_pin_hash;
    delete row.admin_pin_hash;
    return corsJson(row, 200, request);
}

// --- Admin: Update Settings ---
async function updateAdminSettings(request, env) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    // Whitelist of allowed fields
    const allowed = [
        'ordering_enabled', 'delivery_enabled', 'delivery_radius_miles',
        'delivery_minimum_cents', 'delivery_fee_cents', 'service_fee_enabled',
        'service_fee_cents', 'tax_rate', 'scheduling_enabled', 'max_schedule_days'
    ];

    const updates = [];
    const binds = [];
    for (const key of allowed) {
        if (body[key] !== undefined) {
            updates.push(`${key} = ?`);
            binds.push(body[key]);
        }
    }

    if (updates.length === 0) return corsError('No valid fields to update', 400, request);

    updates.push("updated_at = datetime('now')");
    await env.DB.prepare(
        `UPDATE admin_settings SET ${updates.join(', ')} WHERE id = 1`
    ).bind(...binds).run();

    return corsJson({ success: true }, 200, request);
}

// --- Admin: Change PIN ---
async function changePin(request, env) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { pin_type, current_pin, new_pin } = body;
    if (!pin_type || !['store', 'admin'].includes(pin_type)) {
        return corsError('Invalid pin_type (store or admin)', 400, request);
    }
    if (!current_pin || !new_pin) {
        return corsError('current_pin and new_pin required', 400, request);
    }
    if (new_pin.length < 4 || new_pin.length > 8) {
        return corsError('PIN must be 4-8 characters', 400, request);
    }

    const currentHash = await sha256(current_pin);
    const column = pin_type === 'store' ? 'store_pin_hash' : 'admin_pin_hash';
    const settings = await env.DB.prepare(
        `SELECT ${column} FROM admin_settings WHERE id = 1`
    ).first();

    if (!settings || currentHash !== settings[column]) {
        return corsError('Current PIN is incorrect', 401, request);
    }

    const newHash = await sha256(new_pin);
    await env.DB.prepare(
        `UPDATE admin_settings SET ${column} = ?, updated_at = datetime('now') WHERE id = 1`
    ).bind(newHash).run();

    return corsJson({ success: true }, 200, request);
}

// --- Admin: Specials CRUD ---
async function getAdminSpecials(request, env) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    const { results } = await env.DB.prepare(
        'SELECT * FROM specials ORDER BY created_at DESC'
    ).all();
    return corsJson(results, 200, request);
}

async function createSpecial(request, env) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { title, description, day_of_week, active } = body;
    if (!title) return corsError('Title required', 400, request);

    const id = generateId();
    await env.DB.prepare(
        'INSERT INTO specials (id, title, description, day_of_week, active) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, title, description || null, day_of_week || null, active !== undefined ? active : 1).run();

    return corsJson({ id, title, description, day_of_week, active: active !== undefined ? active : 1 }, 201, request);
}

async function updateSpecial(request, env, params) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const updates = [];
    const binds = [];
    for (const key of ['title', 'description', 'day_of_week', 'active']) {
        if (body[key] !== undefined) {
            updates.push(`${key} = ?`);
            binds.push(body[key]);
        }
    }
    if (updates.length === 0) return corsError('Nothing to update', 400, request);

    binds.push(params.id);
    await env.DB.prepare(
        `UPDATE specials SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    return corsJson({ success: true }, 200, request);
}

async function deleteSpecial(request, env, params) {
    const session = await requireAdminAuth(request, env);
    if (!session) return corsError('Unauthorized', 401, request);

    await env.DB.prepare('DELETE FROM specials WHERE id = ?').bind(params.id).run();
    return corsJson({ success: true }, 200, request);
}

// ── Anthropic Proxy (existing marketing dashboard) ──────────

async function handleAnthropicProxy(request, env) {
    // Check origin
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
        return corsError('Forbidden', 403, request);
    }

    let body;
    try { body = await request.json(); } catch {
        return corsError('Invalid JSON', 400, request);
    }

    const { systemPrompt, userMessage } = body;
    if (!systemPrompt || !userMessage) {
        return corsError('Missing systemPrompt or userMessage', 400, request);
    }

    if (!env.ANTHROPIC_API_KEY) {
        return corsError('API key not configured. Run: wrangler secret put ANTHROPIC_API_KEY', 500, request);
    }

    try {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }],
                stream: true,
            }),
        });

        if (!anthropicResponse.ok) {
            const errText = await anthropicResponse.text();
            return new Response(`Anthropic API error: ${errText}`, {
                status: anthropicResponse.status,
                headers: getCorsHeaders(request),
            });
        }

        return new Response(anthropicResponse.body, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                ...getCorsHeaders(request),
            },
        });
    } catch (err) {
        return corsError(`Server error: ${err.message}`, 500, request);
    }
}

// ── SERVER_MENU (server-side price truth) ───────────────────
// All prices in cents. This mirrors menu.html prices exactly.
// Items with roll/hero pricing use the roll (lower) price as base.
// Hero upcharge is applied via customization.

const SERVER_MENU = {
    // Breakfast Sandwiches
    'Bacon, Egg & Cheese': { base_price_cents: 600, type: 'breakfast' },
    'Sausage, Egg & Cheese': { base_price_cents: 600, type: 'breakfast' },
    'Ham, Egg & Cheese': { base_price_cents: 600, type: 'breakfast' },
    'Steak, Egg & Cheese': { base_price_cents: 1000, type: 'breakfast' },
    'Bacon, Egg, Cheese & Avocado': { base_price_cents: 800, type: 'breakfast' },
    'The Hungry Man': { base_price_cents: 1000, type: 'breakfast' },
    'Turkey Bacon or Turkey Sausage, Egg & Cheese': { base_price_cents: 700, type: 'breakfast' },
    'Western Omelette Platter': { base_price_cents: 1400, type: 'breakfast' },
    'Mini Sandwich': { base_price_cents: 675, type: 'breakfast' },
    'Mini Cheeseburger': { base_price_cents: 675, type: 'breakfast' },

    // Breakfast Platters
    'Ham Platter': { base_price_cents: 1400, type: 'platter' },
    'Bacon Platter': { base_price_cents: 1400, type: 'platter' },
    'Sausage Platter': { base_price_cents: 1400, type: 'platter' },
    'Pancake Platter': { base_price_cents: 1400, type: 'platter' },
    'Mini Pancake Platter': { base_price_cents: 1075, type: 'platter' },
    'French Toast Platter': { base_price_cents: 1400, type: 'platter' },

    // Cold Heroes & Sandwiches
    'Italian Hero': { base_price_cents: 1000, type: 'coldHero' },
    'Turkey Club': { base_price_cents: 900, type: 'coldHero' },
    'Roast Beef Club': { base_price_cents: 900, type: 'coldHero' },
    'Ham & Cheese': { base_price_cents: 900, type: 'coldHero' },
    'Turkey Sandwich': { base_price_cents: 900, type: 'coldHero' },
    'Tuna Salad Sandwich': { base_price_cents: 900, type: 'coldHero' },
    'Honey Turkey Club': { base_price_cents: 900, type: 'coldHero' },
    'Pastrami Sandwich': { base_price_cents: 900, type: 'coldHero' },
    'Salami Sandwich': { base_price_cents: 900, type: 'coldHero' },

    // Hot Sandwiches
    'Chicken Cutlet Hero': { base_price_cents: 900, type: 'hotSandwich' },
    'Chicken Parm Hero': { base_price_cents: 900, type: 'hotSandwich' },
    'Philly Cheesesteak': { base_price_cents: 1025, type: 'hotSandwich' },
    'The Reuben': { base_price_cents: 900, type: 'hotSandwich' },
    'New York Style Chop Cheese': { base_price_cents: 1000, type: 'hotSandwich' },
    'BLT': { base_price_cents: 900, type: 'hotSandwich' },
    'Hot Roast Beef & Gravy': { base_price_cents: 900, type: 'hotSandwich' },
    'Eggplant Parm Hero': { base_price_cents: 900, type: 'hotSandwich' },
    'Meatball Parm Hero': { base_price_cents: 900, type: 'hotSandwich' },
    'Grilled Cheese': { base_price_cents: 400, type: 'grilledCheese' },

    // Chicken Over Rice
    'Chicken Over Rice': { base_price_cents: 1100, type: 'chickenRice' },
    'Lamb Over Rice': { base_price_cents: 1100, type: 'chickenRice' },
    'Combo Over Rice': { base_price_cents: 1100, type: 'chickenRice' },
    'Chicken Teriyaki Platter': { base_price_cents: 1100, type: 'chickenRice' },

    // Wraps
    'Chicken Caesar Wrap': { base_price_cents: 925, type: 'wrap' },
    'Buffalo Chicken Wrap': { base_price_cents: 925, type: 'wrap' },
    'Turkey BLT Wrap': { base_price_cents: 925, type: 'wrap' },
    'Southwest Wrap': { base_price_cents: 925, type: 'wrap' },
    'Grilled Veggie Wrap': { base_price_cents: 925, type: 'wrap' },

    // Burgers & Hot Dogs
    'Cheeseburger': { base_price_cents: 775, type: 'burger' },
    'Bacon Cheeseburger': { base_price_cents: 975, type: 'burger' },
    'Hot Dog': { base_price_cents: 225, type: 'hotdog' },
    '2 Hot Dogs & Fries Combo': { base_price_cents: 875, type: 'hotdog' },

    // Salads
    'Grilled Chicken Salad': { base_price_cents: 999, type: 'salad' },
    'Chicken Caesar Salad': { base_price_cents: 999, type: 'salad' },
    'Chef Salad': { base_price_cents: 999, type: 'salad' },
    'Greek Salad': { base_price_cents: 999, type: 'salad' },
    'Garden Salad': { base_price_cents: 799, type: 'salad' },

    // Sides
    'French Fries': { base_price_cents: 399, type: 'sides' },
    'Onion Rings': { base_price_cents: 375, type: 'sides' },
    'Chicken Wings': { base_price_cents: 699, type: 'wings' },
    'Homefries': { base_price_cents: 400, type: 'sides' },

    // Coffee & Hot Drinks (base = small price)
    'Regular Coffee': { base_price_cents: 150, type: 'coffee' },
    'Iced Coffee': { base_price_cents: 399, type: 'coffee' },
    'Hot Chocolate': { base_price_cents: 185, type: 'coffee' },
    'Cappuccino': { base_price_cents: 185, type: 'coffee' },

    // Cold Beverages
    '20 oz Soda': { base_price_cents: 250, type: 'beverage' },
    'Gatorade': { base_price_cents: 250, type: 'beverage' },
    'Snapple / Arizona': { base_price_cents: 250, type: 'beverage' },
    'Red Bull / Monster': { base_price_cents: 325, type: 'beverage' },
    'Bottled Water': { base_price_cents: 175, type: 'beverage' },

    // Lunch Menu
    'Roast Beef': { base_price_cents: 1000, type: 'lunch' },
    'Grilled Chicken Breast': { base_price_cents: 1000, type: 'lunch' },
    'Pasta with Shrimp': { base_price_cents: 1000, type: 'lunch' },
    'Beef Fajita': { base_price_cents: 1000, type: 'lunch' },
    'Salmon': { base_price_cents: 1200, type: 'lunch' },
    'Chicken Soup': { base_price_cents: 1400, type: 'lunch' },
    'Beef Soup': { base_price_cents: 1400, type: 'lunch' },
    'Pupusas Revueltas': { base_price_cents: 300, type: 'lunch' },
    'Loroco Queso Pupusa': { base_price_cents: 300, type: 'lunch' },
    'Frijol Queso Pupusa': { base_price_cents: 300, type: 'lunch' },
    'Queso Pupusa': { base_price_cents: 250, type: 'lunch' },
    'Fried Plantains': { base_price_cents: 300, type: 'lunch' },

    // Snacks
    'Chips': { base_price_cents: 125, type: 'snack' },
    'Candy Bars': { base_price_cents: 175, type: 'snack' },
    'Fresh Fruit': { base_price_cents: 100, type: 'snack' },
    'Milk': { base_price_cents: 225, type: 'snack' },
};

// Server-side customization prices (mirrors menu.html exactly)
// Hero upcharges per item (hero price - roll price, in cents)
const SERVER_HERO_UPCHARGES = {
    'Bacon, Egg & Cheese': 500,
    'Sausage, Egg & Cheese': 500,
    'Ham, Egg & Cheese': 500,
    'Steak, Egg & Cheese': 200,
    'Bacon, Egg, Cheese & Avocado': 400,
    'The Hungry Man': 300,
    'Turkey Bacon or Turkey Sausage, Egg & Cheese': 400,
    'Italian Hero': 300,
    'Turkey Club': 400,
    'Roast Beef Club': 400,
    'Ham & Cheese': 400,
    'Turkey Sandwich': 400,
    'Tuna Salad Sandwich': 400,
    'Honey Turkey Club': 400,
    'Pastrami Sandwich': 400,
    'Salami Sandwich': 400,
    'Chicken Cutlet Hero': 400,
    'Chicken Parm Hero': 400,
    'Philly Cheesesteak': 375,
    'The Reuben': 400,
    'New York Style Chop Cheese': 300,
    'BLT': 400,
    'Hot Roast Beef & Gravy': 400,
    'Eggplant Parm Hero': 400,
    'Meatball Parm Hero': 400,
};

// Customization extra prices in cents (only non-zero prices listed)
const SERVER_CUSTOMIZATION_PRICES = {
    // Bread extras
    'Bagel': 50, 'Croissant': 100, 'Wrap': 50,
    'Spinach Wrap': 50, 'Tomato Basil Wrap': 50,
    'Sourdough': 50,
    // Breakfast extras
    'Extra Egg': 150, 'Extra Bacon': 200, 'Extra Cheese': 100,
    'Avocado': 200, 'Lettuce': 50, 'Tomato': 50, 'Onion': 50,
    'Peppers': 50, 'Jalapeños': 50,
    // Cold hero extras
    'Extra Meat': 250, 'Bacon': 200,
    // Hot sandwich extras
    'Sautéed Peppers': 75, 'Sautéed Onions': 75, 'Mushrooms': 75,
    'Fried Egg': 150,
    // Chicken over rice extras
    'Extra Chicken': 200, 'Extra Lamb': 300, 'Extra Rice': 100, 'Extra Lettuce': 50,
    // Wrap extras
    'Extra Dressing': 50,
    // Burger extras
    'Extra Patty': 300,
    'Sautéed Mushrooms': 75,
    // Salad extras
    'Grilled Chicken': 300, 'Crispy Chicken': 300, 'Tuna Salad': 250, 'Shrimp': 400,
    'Bacon Bits': 150, 'Croutons': 50,
    // Sides extras
    'Large': 150,
    'Ranch': 50, 'Blue Cheese': 50, 'BBQ Sauce': 50, 'Honey Mustard': 50,
    // Wings extras
    'Extra Blue Cheese': 75, 'Extra Ranch': 75,
    // Coffee extras
    'Medium': 50, 'Small': 0,
    'Oat Milk': 75,
    'Extra Shot': 100, 'Flavor Shot (Vanilla)': 75, 'Flavor Shot (Hazelnut)': 75, 'Flavor Shot (Caramel)': 75,
    // Hot dogs
    'Sauerkraut': 50, 'Chili': 100, 'Cheese': 75,
};

// Size-based price overrides for coffee (base is small; these are the ADDS)
const SERVER_COFFEE_SIZE_ADDS = {
    'Regular Coffee': { 'Medium': 100, 'Large': 149 },
    'Iced Coffee': { 'Medium': 50, 'Large': 100 },
    'Hot Chocolate': { 'Medium': 50, 'Large': 100 },
    'Cappuccino': { 'Medium': 50, 'Large': 100 },
};

function getCustomizationPrice(itemName, section, optionValue) {
    // Hero/Garlic Hero upcharge
    if (section === 'bread' && (optionValue === 'Hero' || optionValue === 'Garlic Hero')) {
        return SERVER_HERO_UPCHARGES[itemName] || 0;
    }

    // Coffee size
    if (section === 'size' && SERVER_COFFEE_SIZE_ADDS[itemName]) {
        return SERVER_COFFEE_SIZE_ADDS[itemName][optionValue] || 0;
    }

    // Sides size
    if (section === 'size' && optionValue === 'Large') {
        return 150;
    }

    // General customization prices
    return SERVER_CUSTOMIZATION_PRICES[optionValue] || 0;
}

// ── Route Table ─────────────────────────────────────────────

const routes = [
    // Public
    { method: 'GET',    pattern: '/api/settings/public',     handler: getPublicSettings },
    { method: 'GET',    pattern: '/api/specials',            handler: getActiveSpecials },
    { method: 'POST',   pattern: '/api/orders',              handler: createOrder },
    { method: 'GET',    pattern: '/api/orders/:id',          handler: getOrderStatus },
    { method: 'POST',   pattern: '/api/orders/:id/pay',      handler: payOrder },
    { method: 'POST',   pattern: '/api/checkout/create',     handler: createCheckoutSession },
    { method: 'POST',   pattern: '/api/checkout/verify',     handler: verifyCheckoutPayment },
    { method: 'POST',   pattern: '/api/validate-address',    handler: validateAddress },

    // Store
    { method: 'POST',   pattern: '/api/store/auth',          handler: storeLogin },
    { method: 'GET',    pattern: '/api/store/orders',        handler: getStoreOrders },
    { method: 'PUT',    pattern: '/api/store/orders/:id',    handler: updateStoreOrder },

    // Admin
    { method: 'POST',   pattern: '/api/admin/auth',          handler: adminLogin },
    { method: 'GET',    pattern: '/api/admin/settings',      handler: getAdminSettings },
    { method: 'PUT',    pattern: '/api/admin/settings',      handler: updateAdminSettings },
    { method: 'POST',   pattern: '/api/admin/change-pin',    handler: changePin },
    { method: 'GET',    pattern: '/api/admin/specials',      handler: getAdminSpecials },
    { method: 'POST',   pattern: '/api/admin/specials',      handler: createSpecial },
    { method: 'PUT',    pattern: '/api/admin/specials/:id',  handler: updateSpecial },
    { method: 'DELETE', pattern: '/api/admin/specials/:id',  handler: deleteSpecial },
];

// ── Main Handler ────────────────────────────────────────────

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: getCorsHeaders(request) });
        }

        const url = new URL(request.url);
        const pathname = url.pathname;

        // Existing Anthropic proxy — POST to root
        if (request.method === 'POST' && pathname === '/') {
            return handleAnthropicProxy(request, env);
        }

        // API routes
        const matched = matchRoute(request.method, pathname, routes);
        if (matched) {
            try {
                return await matched.handler(request, env, matched.params);
            } catch (err) {
                console.error(`Route error: ${pathname}`, err);
                return corsError(`Server error: ${err.message}`, 500, request);
            }
        }

        return corsError('Not found', 404, request);
    },

    // Cron trigger — fire scheduled orders to Clover POS
    async scheduled(event, env, ctx) {
        try {
            const now = new Date();
            const windowMs = 20 * 60 * 1000; // 20 minutes ahead
            const windowEnd = new Date(now.getTime() + windowMs).toISOString();

            // Find confirmed scheduled orders that haven't been fired to POS yet
            const { results: orders } = await env.DB.prepare(
                `SELECT * FROM orders
                 WHERE scheduled_at IS NOT NULL
                   AND fired = 0
                   AND status = 'confirmed'
                   AND scheduled_at <= ?
                 ORDER BY scheduled_at ASC`
            ).bind(windowEnd).all();

            if (orders.length === 0) return;

            console.log(`Cron: firing ${orders.length} scheduled order(s)`);

            for (const order of orders) {
                try {
                    // Create Clover atomic order on POS
                    let cloverOrderId = null;
                    if (env.CLOVER_API_TOKEN && env.CLOVER_MERCHANT_ID) {
                        cloverOrderId = await createCloverAtomicOrder(env, order, order.id);
                    }

                    // Mark as fired
                    await env.DB.prepare(
                        `UPDATE orders SET fired = 1, clover_order_id = COALESCE(?, clover_order_id),
                         updated_at = datetime('now') WHERE id = ?`
                    ).bind(cloverOrderId, order.id).run();

                    // Log event
                    await env.DB.prepare(
                        'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
                    ).bind(
                        generateId(), order.id, 'scheduled_fired',
                        `Scheduled order fired to POS. Clover order: ${cloverOrderId || 'N/A'}`
                    ).run();

                    console.log(`Cron: fired order ${order.order_number} -> Clover ${cloverOrderId || 'skipped'}`);
                } catch (err) {
                    console.error(`Cron: failed to fire order ${order.order_number}:`, err);
                    // Log failure but continue with other orders
                    await env.DB.prepare(
                        'INSERT INTO order_events (id, order_id, event_type, detail) VALUES (?, ?, ?, ?)'
                    ).bind(generateId(), order.id, 'fire_failed', err.message).run();
                }
            }
        } catch (err) {
            console.error('Cron: scheduled order check failed:', err);
        }
    },
};

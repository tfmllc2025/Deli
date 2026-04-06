// ============================================================
// Quickstop Super Deli — Checkout Page Logic
//
// Handles: cart review, customer info, order type, timing,
// price summary, address validation, order submission,
// Clover payment iframe, and status polling.
// ============================================================

const API_BASE = 'https://superdeli-marketing-api.sricharangumudavelli.workers.dev';

// ── State ────────────────────────────────────────────────────

let orderType = 'pickup';   // 'pickup' | 'delivery'
let timing = 'asap';        // 'asap' | 'scheduled'
let settings = null;        // fetched from /api/settings/public
let addressValid = false;
let addressData = null;      // geocoded result from API
let addressCheckTimer = null;
let orderId = null;          // set after order created
let statusPollInterval = null;
let returnFromPayment = false; // true when redirected back from Clover

// ── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Check if returning from Clover payment
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('status');
    const returnOrderId = urlParams.get('order_id');

    if (paymentStatus && returnOrderId) {
        returnFromPayment = true;
        orderId = returnOrderId;

        // Clean up URL without reloading
        history.replaceState(null, '', '/order.html');

        if (paymentStatus === 'success') {
            // Verify payment and show confirmation
            document.getElementById('emptyCart').style.display = 'none';
            document.getElementById('checkoutForm').style.display = 'none';
            await handlePaymentReturn(returnOrderId);
            return;
        } else {
            // Payment failed — show error and let them try again
            showGlobalError('Payment was not completed. Please try again.');
        }
    }

    if (cart.isEmpty() && !returnFromPayment) {
        document.getElementById('emptyCart').style.display = 'block';
        document.getElementById('checkoutForm').style.display = 'none';
        return;
    }

    document.getElementById('emptyCart').style.display = 'none';
    document.getElementById('checkoutForm').style.display = 'block';

    renderCartReview();
    loadSettings();
    populateScheduleDates();
    setupAddressDebounce();
    restoreCustomerInfo();
});

// ── Load Settings ────────────────────────────────────────────

async function loadSettings() {
    try {
        const resp = await fetch(`${API_BASE}/api/settings/public`);
        if (!resp.ok) throw new Error('Failed to load settings');
        settings = await resp.json();

        // Disable delivery button if delivery is off
        const btnDelivery = document.getElementById('btnDelivery');
        if (!settings.delivery_enabled) {
            btnDelivery.disabled = true;
            btnDelivery.title = 'Delivery currently unavailable';
        }

        // Disable scheduling if off
        const btnSchedule = document.getElementById('btnSchedule');
        if (!settings.scheduling_enabled) {
            btnSchedule.disabled = true;
            btnSchedule.title = 'Scheduled orders currently unavailable';
        }

        // Check if ordering is disabled
        if (!settings.ordering_enabled) {
            showGlobalError('Online ordering is currently turned off. Please call us at (631) 286-1491.');
            document.getElementById('placeOrderBtn').disabled = true;
            return;
        }

        updateSummary();
        document.getElementById('placeOrderBtn').disabled = false;
    } catch (err) {
        showGlobalError('Could not connect to the server. Please try again or call (631) 286-1491.');
    }
}

// ── Cart Review ──────────────────────────────────────────────

function renderCartReview() {
    const container = document.getElementById('cartReview');
    const items = cart.getItems();
    container.innerHTML = items.map(item => {
        const details = cart.getCustomizationSummary(item);
        return `
            <div class="review-item">
                <div class="review-item-info">
                    <div class="review-item-name">${escapeHtml(item.item_name)}</div>
                    ${details ? `<div class="review-item-details">${escapeHtml(details)}</div>` : ''}
                    ${item.quantity > 1 ? `<div class="review-item-qty">Qty: ${item.quantity}</div>` : ''}
                </div>
                <div class="review-item-price">$${item.line_total.toFixed(2)}</div>
            </div>
        `;
    }).join('');
}

// ── Order Type Toggle ────────────────────────────────────────

function setOrderType(type) {
    orderType = type;
    document.getElementById('btnPickup').classList.toggle('active', type === 'pickup');
    document.getElementById('btnDelivery').classList.toggle('active', type === 'delivery');
    document.getElementById('deliveryFields').style.display = type === 'delivery' ? 'block' : 'none';

    if (type === 'delivery' && settings) {
        const minDollars = (settings.delivery_minimum_cents / 100).toFixed(2);
        const note = document.getElementById('deliveryMinNote');
        note.textContent = `Delivery minimum: $${minDollars} · Radius: ${settings.delivery_radius_miles} miles · Free delivery`;
        if (settings.delivery_fee_cents > 0) {
            note.textContent = `Delivery minimum: $${minDollars} · Radius: ${settings.delivery_radius_miles} mi · Fee: $${(settings.delivery_fee_cents / 100).toFixed(2)}`;
        }
        note.style.display = 'block';
    }

    // Update delivery status steps for delivery orders
    updateStatusSteps();
    updateSummary();
}

function updateStatusSteps() {
    const readyStep = document.getElementById('stepReady');
    if (orderType === 'delivery') {
        readyStep.querySelector('span').textContent = 'Out for Delivery';
    } else {
        readyStep.querySelector('span').textContent = 'Ready for Pickup';
    }
}

// ── Timing Toggle ────────────────────────────────────────────

function setTiming(t) {
    timing = t;
    document.getElementById('btnAsap').classList.toggle('active', t === 'asap');
    document.getElementById('btnSchedule').classList.toggle('active', t === 'scheduled');
    document.getElementById('scheduleFields').style.display = t === 'scheduled' ? 'block' : 'none';
}

// ── Schedule Dates/Times ─────────────────────────────────────

function populateScheduleDates() {
    const dateSelect = document.getElementById('scheduleDate');
    const maxDays = (settings && settings.max_schedule_days) || 3;
    const today = new Date();

    dateSelect.innerHTML = '';
    for (let i = 0; i <= maxDays; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const value = d.toISOString().split('T')[0];
        dateSelect.innerHTML += `<option value="${value}">${label}</option>`;
    }

    populateScheduleTimes();
    dateSelect.addEventListener('change', populateScheduleTimes);
}

function populateScheduleTimes() {
    const timeSelect = document.getElementById('scheduleTime');
    const dateSelect = document.getElementById('scheduleDate');
    const isToday = dateSelect.value === new Date().toISOString().split('T')[0];
    const now = new Date();
    const minHour = 5;  // 5:00 AM
    const maxHour = 18; // last slot 6:30 PM (18:30)

    timeSelect.innerHTML = '';

    for (let h = minHour; h <= maxHour; h++) {
        for (let m = 0; m < 60; m += 30) {
            if (h === maxHour && m > 30) continue; // max 6:30 PM

            // Skip past times if today (add 45 min buffer for prep)
            if (isToday) {
                const slotTime = new Date(now);
                slotTime.setHours(h, m, 0, 0);
                if (slotTime.getTime() < now.getTime() + 45 * 60 * 1000) continue;
            }

            const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
            const ampm = h >= 12 ? 'PM' : 'AM';
            const label = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
            const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            timeSelect.innerHTML += `<option value="${value}">${label}</option>`;
        }
    }

    if (timeSelect.options.length === 0) {
        timeSelect.innerHTML = '<option value="">No times available</option>';
    }
}

// ── Address Validation ───────────────────────────────────────

function setupAddressDebounce() {
    const input = document.getElementById('deliveryAddress');
    input.addEventListener('input', () => {
        clearTimeout(addressCheckTimer);
        addressValid = false;
        addressData = null;
        const status = document.getElementById('addressStatus');
        status.className = 'address-status';
        status.style.display = 'none';

        if (input.value.trim().length >= 5) {
            addressCheckTimer = setTimeout(() => validateAddress(input.value.trim()), 800);
        }
    });
}

async function validateAddress(address) {
    const status = document.getElementById('addressStatus');
    status.className = 'address-status visible loading';
    status.innerHTML = '<div class="spinner"></div> Checking address...';

    try {
        const resp = await fetch(`${API_BASE}/api/validate-address`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address }),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Address validation failed');
        }

        const data = await resp.json();

        if (data.valid) {
            addressValid = true;
            addressData = data;
            status.className = 'address-status visible success';
            status.innerHTML = `&#10003; ${escapeHtml(data.formatted_address)} (${data.distance_miles} mi)`;
        } else {
            addressValid = false;
            addressData = null;
            status.className = 'address-status visible fail';
            status.innerHTML = `&#10007; ${escapeHtml(data.reason || 'Address is outside delivery area')}`;
        }
    } catch (err) {
        addressValid = false;
        status.className = 'address-status visible fail';
        status.innerHTML = `&#10007; ${escapeHtml(err.message)}`;
    }
}

// ── Price Summary ────────────────────────────────────────────

function updateSummary() {
    if (!settings) return;

    const summary = cart.getSummary();
    const subtotalCents = Math.round(summary.subtotal * 100);
    const taxCents = Math.round(subtotalCents * settings.tax_rate);
    const deliveryFeeCents = orderType === 'delivery' ? settings.delivery_fee_cents : 0;
    const serviceFeeCents = settings.service_fee_enabled ? settings.service_fee_cents : 0;
    const totalCents = subtotalCents + taxCents + deliveryFeeCents + serviceFeeCents;

    document.getElementById('summarySubtotal').textContent = formatCents(subtotalCents);
    document.getElementById('summaryTax').textContent = formatCents(taxCents);

    // Delivery fee line
    const deliveryLine = document.getElementById('deliveryFeeLine');
    if (deliveryFeeCents > 0 && orderType === 'delivery') {
        deliveryLine.style.display = 'flex';
        document.getElementById('summaryDeliveryFee').textContent = formatCents(deliveryFeeCents);
    } else {
        deliveryLine.style.display = 'none';
    }

    // Service fee line
    const serviceLine = document.getElementById('serviceFeeLine');
    if (serviceFeeCents > 0) {
        serviceLine.style.display = 'flex';
        document.getElementById('summaryServiceFee').textContent = formatCents(serviceFeeCents);
    } else {
        serviceLine.style.display = 'none';
    }

    document.getElementById('summaryTotal').textContent = formatCents(totalCents);
    document.getElementById('btnTotal').textContent = formatCents(totalCents);
}

// ── Form Validation ──────────────────────────────────────────

function validateForm() {
    let valid = true;

    // Name
    const name = document.getElementById('customerName').value.trim();
    if (!name) {
        showFieldError('customerName', 'nameError');
        valid = false;
    } else {
        clearFieldError('customerName', 'nameError');
    }

    // Phone
    const phone = document.getElementById('customerPhone').value.trim();
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10) {
        showFieldError('customerPhone', 'phoneError');
        valid = false;
    } else {
        clearFieldError('customerPhone', 'phoneError');
    }

    // Delivery address
    if (orderType === 'delivery') {
        const addr = document.getElementById('deliveryAddress').value.trim();
        if (!addr) {
            showFieldError('deliveryAddress', 'addressError');
            valid = false;
        } else {
            clearFieldError('deliveryAddress', 'addressError');
        }

        if (!addressValid) {
            showGlobalError('Please enter a valid delivery address within our delivery area.');
            valid = false;
        }

        // Check delivery minimum
        if (settings) {
            const subtotalCents = Math.round(cart.getSummary().subtotal * 100);
            if (subtotalCents < settings.delivery_minimum_cents) {
                const minDollars = (settings.delivery_minimum_cents / 100).toFixed(2);
                showGlobalError(`Delivery minimum is $${minDollars}. Add more items to your order.`);
                valid = false;
            }
        }
    }

    // Scheduled time
    if (timing === 'scheduled') {
        const time = document.getElementById('scheduleTime').value;
        if (!time) {
            showGlobalError('Please select a scheduled time.');
            valid = false;
        }
    }

    return valid;
}

function showFieldError(inputId, errorId) {
    document.getElementById(inputId).classList.add('error');
    document.getElementById(errorId).classList.add('visible');
}
function clearFieldError(inputId, errorId) {
    document.getElementById(inputId).classList.remove('error');
    document.getElementById(errorId).classList.remove('visible');
}

// ── Place Order (Hosted Checkout Redirect) ──────────────────

async function placeOrder() {
    hideGlobalError();

    if (!validateForm()) return;

    const btn = document.getElementById('placeOrderBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> <span>Processing...</span>';

    // Save customer info for next time
    saveCustomerInfo();

    // Build scheduled_at if needed
    let scheduledAt = null;
    if (timing === 'scheduled') {
        const date = document.getElementById('scheduleDate').value;
        const time = document.getElementById('scheduleTime').value;
        scheduledAt = `${date}T${time}:00`;
    }

    // Build order payload
    const payload = {
        items: cart.toApiPayload(),
        customer_name: document.getElementById('customerName').value.trim(),
        customer_phone: document.getElementById('customerPhone').value.trim(),
        customer_email: document.getElementById('customerEmail').value.trim() || undefined,
        order_type: orderType,
        delivery_address: orderType === 'delivery' ? document.getElementById('deliveryAddress').value.trim() : undefined,
        scheduled_at: scheduledAt,
    };

    try {
        // Step 1: Create order (server-side price validation)
        const resp = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Failed to create order');
        }

        orderId = data.order_id;

        // Step 2: Create Clover hosted checkout session
        btn.innerHTML = '<div class="spinner"></div> <span>Redirecting to Payment...</span>';

        const checkoutResp = await fetch(`${API_BASE}/api/checkout/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId }),
        });

        const checkoutData = await checkoutResp.json();

        if (!checkoutResp.ok) {
            throw new Error(checkoutData.error || 'Could not create payment session.');
        }

        // Step 3: Redirect to Clover's hosted checkout page
        window.location.href = checkoutData.checkout_url;

    } catch (err) {
        showGlobalError(err.message);
        btn.disabled = false;
        btn.innerHTML = '<span>Place Order</span><span class="btn-total" id="btnTotal">' + document.getElementById('summaryTotal').textContent + '</span>';
    }
}

// ── Handle Return from Clover Payment ───────────────────────

async function handlePaymentReturn(returnOrderId) {
    try {
        // Verify payment with our server
        const resp = await fetch(`${API_BASE}/api/checkout/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: returnOrderId }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Could not verify payment.');
        }

        // Show confirmation
        const conf = document.getElementById('confirmationScreen');
        conf.classList.add('visible');
        document.getElementById('confirmOrderNumber').textContent = data.order_number;
        document.getElementById('confirmMessage').innerHTML =
            data.order_type === 'delivery'
                ? 'Your order has been placed! We\'ll deliver it as soon as it\'s ready.'
                : 'Your order has been placed! We\'ll start preparing it right away.';

        // Clear cart
        cart.clear();

        // Start polling
        startStatusPolling(returnOrderId);

    } catch (err) {
        // Even if verify fails, show a basic confirmation with polling
        const conf = document.getElementById('confirmationScreen');
        conf.classList.add('visible');
        document.getElementById('confirmMessage').innerHTML =
            'Your payment has been received! Your order is being processed.';
        cart.clear();
        startStatusPolling(returnOrderId);
    }
}

// ── Confirmation ─────────────────────────────────────────────

function showConfirmation(orderData) {
    // Hide form, show confirmation
    document.getElementById('checkoutForm').style.display = 'none';
    const conf = document.getElementById('confirmationScreen');
    conf.classList.add('visible');

    document.getElementById('confirmOrderNumber').textContent = orderData.order_number;

    if (timing === 'scheduled') {
        const dt = new Date(document.getElementById('scheduleDate').value + 'T' + document.getElementById('scheduleTime').value);
        const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        document.getElementById('confirmMessage').innerHTML =
            `Your order is scheduled for <strong>${dateStr} at ${timeStr}</strong>.<br>We'll have it ready when you arrive!`;
    } else {
        document.getElementById('confirmMessage').innerHTML =
            orderType === 'delivery'
                ? 'Your order has been placed! We\'ll deliver it as soon as it\'s ready.'
                : 'Your order has been placed! We\'ll start preparing it right away.';
    }

    // Update status steps for delivery
    updateStatusSteps();

    // Clear cart
    cart.clear();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Start polling order status
    if (orderId) {
        startStatusPolling(orderId);
    }
}

// ── Status Polling ───────────────────────────────────────────

function startStatusPolling(id) {
    // Poll every 10 seconds
    pollOrderStatus(id);
    statusPollInterval = setInterval(() => pollOrderStatus(id), 10000);
}

async function pollOrderStatus(id) {
    try {
        const resp = await fetch(`${API_BASE}/api/orders/${id}`);
        if (!resp.ok) return;
        const data = await resp.json();

        updateStatusTracker(data.status);

        if (data.estimated_ready) {
            const ready = new Date(data.estimated_ready);
            const now = new Date();
            const minsLeft = Math.max(0, Math.round((ready - now) / 60000));
            if (minsLeft > 0) {
                document.getElementById('estimatedTime').textContent = `~${minsLeft} min remaining`;
            } else {
                document.getElementById('estimatedTime').textContent = 'Should be ready now!';
            }
        }

        // Stop polling on terminal statuses
        const terminal = ['picked_up', 'delivered', 'cancelled'];
        if (terminal.includes(data.status)) {
            clearInterval(statusPollInterval);

            if (data.status === 'cancelled') {
                document.getElementById('confirmMessage').innerHTML =
                    'Your order has been cancelled. Please call us at <a href="tel:+16312861491">(631) 286-1491</a> for details.';
            }
        }
    } catch {
        // Silently retry on next interval
    }
}

const STATUS_ORDER = ['pending_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'picked_up', 'delivered'];

function updateStatusTracker(currentStatus) {
    const steps = document.querySelectorAll('.status-step');
    const currentIdx = STATUS_ORDER.indexOf(currentStatus);

    steps.forEach(step => {
        const stepStatus = step.dataset.status;
        const stepIdx = STATUS_ORDER.indexOf(stepStatus);

        step.classList.remove('active', 'done');
        if (stepIdx < currentIdx) {
            step.classList.add('done');
        } else if (stepIdx === currentIdx) {
            step.classList.add('active');
        }
    });
}

// ── Customer Info Persistence ────────────────────────────────

function saveCustomerInfo() {
    try {
        localStorage.setItem('qsd_customer', JSON.stringify({
            name: document.getElementById('customerName').value.trim(),
            phone: document.getElementById('customerPhone').value.trim(),
            email: document.getElementById('customerEmail').value.trim(),
        }));
    } catch { /* ignore */ }
}

function restoreCustomerInfo() {
    try {
        const raw = localStorage.getItem('qsd_customer');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.name) document.getElementById('customerName').value = data.name;
        if (data.phone) document.getElementById('customerPhone').value = data.phone;
        if (data.email) document.getElementById('customerEmail').value = data.email;
    } catch { /* ignore */ }
}

// ── Utility ──────────────────────────────────────────────────

function formatCents(cents) {
    return '$' + (cents / 100).toFixed(2);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showGlobalError(msg) {
    const el = document.getElementById('globalError');
    el.textContent = msg;
    el.classList.add('visible');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideGlobalError() {
    const el = document.getElementById('globalError');
    el.classList.remove('visible');
}

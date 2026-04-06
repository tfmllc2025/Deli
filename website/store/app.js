// ============================================================
// Quickstop Super Deli — Store Order Dashboard Logic
//
// Handles: PIN auth, order polling (15s), audio alerts,
// order confirmation with prep time, status transitions.
// All API routes already built in Worker (Chunk 1).
// ============================================================

const API_BASE = 'https://superdeli-marketing-api.sricharangumudavelli.workers.dev';

let authToken = null;
let orders = [];
let knownOrderIds = new Set();
let pollInterval = null;
let currentFilter = 'active';
let muted = false;
let confirmingOrderId = null;

// ── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    authToken = sessionStorage.getItem('store_token');
    if (authToken) {
        showDashboard();
    }

    document.getElementById('pinInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });
});

// ── Auth ─────────────────────────────────────────────────────

async function doLogin() {
    const pin = document.getElementById('pinInput').value;
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    if (!pin || pin.length < 4) {
        errEl.textContent = 'Enter a 4-8 digit PIN';
        errEl.classList.add('visible');
        return;
    }

    btn.disabled = true;
    errEl.classList.remove('visible');

    try {
        const resp = await fetch(`${API_BASE}/api/store/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin }),
        });

        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Login failed');

        authToken = data.token;
        sessionStorage.setItem('store_token', authToken);
        showDashboard();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('visible');
    } finally {
        btn.disabled = false;
    }
}

function doLogout() {
    authToken = null;
    sessionStorage.removeItem('store_token');
    clearInterval(pollInterval);
    pollInterval = null;
    orders = [];
    knownOrderIds.clear();
    document.getElementById('dashboard').classList.remove('visible');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('pinInput').value = '';
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('visible');

    // Seed known IDs on first load (no alert for existing orders)
    fetchOrders(true);

    // Poll every 15 seconds
    pollInterval = setInterval(() => fetchOrders(false), 15000);
}

// ── Order Polling ────────────────────────────────────────────

async function fetchOrders(isInitial) {
    try {
        const resp = await fetch(`${API_BASE}/api/store/orders`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) throw new Error('Fetch failed');

        const data = await resp.json();
        orders = data;

        // Check for new orders (not in knownOrderIds)
        if (!isInitial) {
            const newOrders = orders.filter(o => !knownOrderIds.has(o.id));
            if (newOrders.length > 0) {
                playAlertSound();
            }
        }

        // Update known set
        knownOrderIds = new Set(orders.map(o => o.id));

        updateCounts();
        renderOrders();
        updatePollStatus('Last updated: ' + new Date().toLocaleTimeString());
    } catch (err) {
        updatePollStatus('Connection error — retrying...');
    }
}

function updatePollStatus(msg) {
    document.getElementById('pollStatus').textContent = msg;
}

// ── Audio Alert (Web Audio API) ──────────────────────────────

function playAlertSound() {
    if (muted) return;

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5 — three ascending beeps

        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.value = 0.3;

            const start = ctx.currentTime + i * 0.2;
            osc.start(start);
            gain.gain.setValueAtTime(0.3, start);
            gain.gain.exponentialRampToValueAtTime(0.01, start + 0.15);
            osc.stop(start + 0.2);
        });
    } catch {
        // Web Audio not supported — silent fallback
    }
}

function toggleMute() {
    muted = !muted;
    const btn = document.getElementById('muteBtn');
    btn.textContent = muted ? 'Sound: OFF' : 'Sound: ON';
    btn.classList.toggle('muted', muted);
}

// ── Filter ───────────────────────────────────────────────────

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    renderOrders();
}

function updateCounts() {
    const counts = { active: 0, pending_payment: 0, confirmed: 0, preparing: 0, ready: 0 };
    for (const o of orders) {
        if (counts[o.status] !== undefined) counts[o.status]++;
        // "active" = all non-terminal
        counts.active++;
    }
    // Include out_for_delivery in active
    document.getElementById('countActive').textContent = counts.active;
    document.getElementById('countPending').textContent = counts.pending_payment;
    document.getElementById('countConfirmed').textContent = counts.confirmed;
    document.getElementById('countPreparing').textContent = counts.preparing;
    document.getElementById('countReady').textContent = counts.ready;
}

// ── Render Orders ────────────────────────────────────────────

function renderOrders() {
    const container = document.getElementById('ordersContainer');
    const empty = document.getElementById('emptyOrders');

    let filtered = orders;
    if (currentFilter !== 'active') {
        filtered = orders.filter(o => o.status === currentFilter);
    }

    if (filtered.length === 0) {
        empty.style.display = 'block';
        // Remove any existing order cards
        container.querySelectorAll('.order-card').forEach(c => c.remove());
        return;
    }

    empty.style.display = 'none';

    // Sort: pending first, then by created_at desc
    const statusPriority = { pending_payment: 0, confirmed: 1, preparing: 2, ready: 3, out_for_delivery: 4 };
    filtered.sort((a, b) => {
        const pa = statusPriority[a.status] ?? 99;
        const pb = statusPriority[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const html = filtered.map(o => renderOrderCard(o)).join('');

    // Replace content (keep empty div)
    container.querySelectorAll('.order-card').forEach(c => c.remove());
    container.insertAdjacentHTML('beforeend', html);
}

function renderOrderCard(order) {
    const items = order.items || [];
    const createdAt = new Date(order.created_at);
    const timeStr = createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    let etaHtml = '';
    if (order.estimated_ready && order.status === 'preparing') {
        const ready = new Date(order.estimated_ready);
        const minsLeft = Math.max(0, Math.round((ready - Date.now()) / 60000));
        etaHtml = `<div class="order-eta">~${minsLeft} min remaining</div>`;
    }

    let scheduledHtml = '';
    if (order.scheduled_at) {
        const sched = new Date(order.scheduled_at);
        const schedStr = sched.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        scheduledHtml = `<div class="order-scheduled-note">Scheduled for ${escapeHtml(schedStr)}</div>`;
    }

    const itemsHtml = items.map(item => {
        const customizations = item.customizations ? JSON.parse(item.customizations) : null;
        let detailStr = '';
        if (customizations) {
            const parts = [];
            for (const [, selected] of Object.entries(customizations)) {
                if (Array.isArray(selected)) {
                    selected.forEach(s => parts.push(s.value));
                } else if (selected && selected.value) {
                    parts.push(selected.value);
                }
            }
            detailStr = parts.join(', ');
        }

        return `
            <div class="order-line">
                <span class="order-line-qty">${item.quantity}x</span>
                <span class="order-line-name">
                    ${escapeHtml(item.item_name)}
                    ${detailStr ? `<br><span class="order-line-detail">${escapeHtml(detailStr)}</span>` : ''}
                    ${item.special_instructions ? `<br><span class="order-line-detail" style="font-style:italic;">"${escapeHtml(item.special_instructions)}"</span>` : ''}
                </span>
                <span class="order-line-price">$${(item.line_total_cents / 100).toFixed(2)}</span>
            </div>
        `;
    }).join('');

    const actionsHtml = getActionsForStatus(order);

    return `
        <div class="order-card" data-status="${order.status}" data-id="${order.id}">
            <div class="order-header">
                <div>
                    <div class="order-number">${escapeHtml(order.order_number)}</div>
                    <div class="order-meta">
                        <span class="order-type-badge ${order.order_type}">${order.order_type}</span>
                        <span class="order-time">${timeStr}</span>
                    </div>
                    ${etaHtml}
                </div>
                <div class="order-status-badge ${order.status}">${formatStatus(order.status)}</div>
            </div>
            <div class="order-body">
                <div class="order-customer">
                    <div class="customer-name">${escapeHtml(order.customer_name)}</div>
                    <div class="customer-phone"><a href="tel:${order.customer_phone}">${escapeHtml(order.customer_phone)}</a></div>
                    ${order.delivery_address ? `<div class="delivery-addr">${escapeHtml(order.delivery_address)}</div>` : ''}
                </div>
                <div class="order-items-list">
                    ${itemsHtml}
                </div>
                <div class="order-total-row">
                    <span class="order-total-label">Total</span>
                    <span class="order-total-amount">$${(order.total_cents / 100).toFixed(2)}</span>
                </div>
                ${scheduledHtml}
            </div>
            ${actionsHtml}
        </div>
    `;
}

function getActionsForStatus(order) {
    const id = order.id;
    let buttons = '';

    switch (order.status) {
        case 'pending_payment':
            buttons = `
                <button class="action-btn primary" onclick="openConfirmModal('${id}', '${escapeHtml(order.order_number)}')">Confirm Order</button>
                <button class="action-btn cancel" onclick="cancelOrder('${id}')">Cancel</button>
            `;
            break;
        case 'confirmed':
            buttons = `
                <button class="action-btn primary" onclick="updateStatus('${id}', 'preparing')">Start Preparing</button>
                <button class="action-btn cancel" onclick="cancelOrder('${id}')">Cancel</button>
            `;
            break;
        case 'preparing':
            buttons = `
                <button class="action-btn success" onclick="updateStatus('${id}', 'ready')">Mark Ready</button>
            `;
            break;
        case 'ready':
            if (order.order_type === 'delivery') {
                buttons = `
                    <button class="action-btn complete" onclick="updateStatus('${id}', 'out_for_delivery')">Out for Delivery</button>
                    <button class="action-btn success" onclick="updateStatus('${id}', 'picked_up')">Picked Up</button>
                `;
            } else {
                buttons = `
                    <button class="action-btn complete" onclick="updateStatus('${id}', 'picked_up')">Picked Up</button>
                `;
            }
            break;
        case 'out_for_delivery':
            buttons = `
                <button class="action-btn complete" onclick="updateStatus('${id}', 'delivered')">Delivered</button>
            `;
            break;
        default:
            return '';
    }

    return `<div class="order-actions">${buttons}</div>`;
}

function formatStatus(status) {
    const map = {
        pending_payment: 'Pending',
        confirmed: 'Confirmed',
        preparing: 'Preparing',
        ready: 'Ready',
        out_for_delivery: 'Delivering',
        picked_up: 'Picked Up',
        delivered: 'Delivered',
        cancelled: 'Cancelled',
    };
    return map[status] || status;
}

// ── Confirm Modal (Prep Time) ────────────────────────────────

function openConfirmModal(orderId, orderNumber) {
    confirmingOrderId = orderId;
    document.getElementById('confirmModalOrder').textContent = orderNumber;
    document.getElementById('confirmModal').classList.add('visible');
}

function closeConfirmModal() {
    confirmingOrderId = null;
    document.getElementById('confirmModal').classList.remove('visible');
}

async function confirmWithPrep(minutes) {
    if (!confirmingOrderId) return;
    const id = confirmingOrderId;
    closeConfirmModal();
    await updateStatus(id, 'confirmed', minutes);
}

// ── Status Updates ───────────────────────────────────────────

async function updateStatus(orderId, status, prepMinutes) {
    // Disable action buttons on this card
    const card = document.querySelector(`.order-card[data-id="${orderId}"]`);
    if (card) {
        card.querySelectorAll('.action-btn').forEach(b => b.disabled = true);
    }

    const payload = { status };
    if (prepMinutes) payload.prep_minutes = prepMinutes;

    try {
        const resp = await fetch(`${API_BASE}/api/store/orders/${orderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(payload),
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || 'Update failed');
        }

        showToast(`Order ${formatStatus(status)}`);

        // Refresh immediately
        fetchOrders(false);
    } catch (err) {
        showToast(err.message);
        // Re-enable buttons
        if (card) {
            card.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
        }
    }
}

async function cancelOrder(orderId) {
    if (!confirm('Cancel this order? This cannot be undone.')) return;
    await updateStatus(orderId, 'cancelled');
}

// ── Utility ──────────────────────────────────────────────────

let toastTimer;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

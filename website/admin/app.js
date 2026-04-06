// ============================================================
// Quickstop Super Deli — Admin Dashboard Logic
//
// Handles: PIN auth, settings CRUD, specials CRUD, PIN changes.
// All API routes are already built in the Worker (Chunk 1).
// ============================================================

const API_BASE = 'https://superdeli-marketing-api.sricharangumudavelli.workers.dev';
let authToken = null;

// ── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Check for saved session
    authToken = sessionStorage.getItem('admin_token');
    if (authToken) {
        showDashboard();
    }

    // Enter key on PIN input
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
        const resp = await fetch(`${API_BASE}/api/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Login failed');
        }

        authToken = data.token;
        sessionStorage.setItem('admin_token', authToken);
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
    sessionStorage.removeItem('admin_token');
    document.getElementById('dashboard').classList.remove('visible');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('pinInput').value = '';
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('visible');
    loadSettings();
    loadSpecials();
}

function apiHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
    };
}

// ── Tabs ─────────────────────────────────────────────────────

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('visible'));
    event.currentTarget.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('visible');
}

// ── Settings ─────────────────────────────────────────────────

async function loadSettings() {
    try {
        const resp = await fetch(`${API_BASE}/api/admin/settings`, {
            headers: apiHeaders(),
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) throw new Error('Failed to load');

        const s = await resp.json();

        document.getElementById('setOrderingEnabled').checked = !!s.ordering_enabled;
        document.getElementById('setSchedulingEnabled').checked = !!s.scheduling_enabled;
        document.getElementById('setMaxScheduleDays').value = s.max_schedule_days;
        document.getElementById('setDeliveryEnabled').checked = !!s.delivery_enabled;
        document.getElementById('setDeliveryRadius').value = s.delivery_radius_miles;
        document.getElementById('setDeliveryMin').value = (s.delivery_minimum_cents / 100).toFixed(0);
        document.getElementById('setDeliveryFee').value = (s.delivery_fee_cents / 100).toFixed(2);
        document.getElementById('setServiceFeeEnabled').checked = !!s.service_fee_enabled;
        document.getElementById('setServiceFee').value = (s.service_fee_cents / 100).toFixed(2);
        document.getElementById('setTaxRate').value = +(s.tax_rate * 100).toFixed(3);
    } catch (err) {
        showStatus('settingsStatus', err.message, 'error');
    }
}

async function saveSettings() {
    const btn = document.getElementById('saveSettingsBtn');
    btn.disabled = true;

    const payload = {
        ordering_enabled: document.getElementById('setOrderingEnabled').checked ? 1 : 0,
        scheduling_enabled: document.getElementById('setSchedulingEnabled').checked ? 1 : 0,
        max_schedule_days: parseInt(document.getElementById('setMaxScheduleDays').value) || 3,
        delivery_enabled: document.getElementById('setDeliveryEnabled').checked ? 1 : 0,
        delivery_radius_miles: parseFloat(document.getElementById('setDeliveryRadius').value) || 10,
        delivery_minimum_cents: Math.round((parseFloat(document.getElementById('setDeliveryMin').value) || 0) * 100),
        delivery_fee_cents: Math.round((parseFloat(document.getElementById('setDeliveryFee').value) || 0) * 100),
        service_fee_enabled: document.getElementById('setServiceFeeEnabled').checked ? 1 : 0,
        service_fee_cents: Math.round((parseFloat(document.getElementById('setServiceFee').value) || 0) * 100),
        tax_rate: (parseFloat(document.getElementById('setTaxRate').value) || 8.625) / 100,
    };

    try {
        const resp = await fetch(`${API_BASE}/api/admin/settings`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify(payload),
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || 'Save failed');
        }

        showStatus('settingsStatus', 'Settings saved!', 'success');
        showToast('Settings saved');
    } catch (err) {
        showStatus('settingsStatus', err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Specials ─────────────────────────────────────────────────

let specials = [];

async function loadSpecials() {
    try {
        const resp = await fetch(`${API_BASE}/api/admin/specials`, {
            headers: apiHeaders(),
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) throw new Error('Failed to load');

        specials = await resp.json();
        renderSpecials();
    } catch (err) {
        document.getElementById('specialsList').innerHTML =
            `<p style="color: var(--deli-red); font-weight: 600;">${escapeHtml(err.message)}</p>`;
    }
}

function renderSpecials() {
    const container = document.getElementById('specialsList');
    if (specials.length === 0) {
        container.innerHTML = '<p style="color: var(--deli-brown); text-align: center; padding: 1rem;">No specials yet. Add one below!</p>';
        return;
    }

    container.innerHTML = specials.map(s => `
        <div class="special-card">
            <div class="special-info">
                <div class="special-title">${escapeHtml(s.title)}</div>
                ${s.description ? `<div class="special-desc">${escapeHtml(s.description)}</div>` : ''}
                <div class="special-meta">
                    ${s.day_of_week ? `<span class="special-tag day">${s.day_of_week}</span>` : '<span class="special-tag day">Every Day</span>'}
                    <span class="special-tag ${s.active ? 'active' : 'inactive'}">${s.active ? 'Active' : 'Inactive'}</span>
                </div>
            </div>
            <div class="special-actions">
                <button class="btn-sm btn-edit" onclick="editSpecial('${s.id}')">Edit</button>
                <button class="btn-sm btn-delete" onclick="deleteSpecial('${s.id}', '${escapeHtml(s.title).replace(/'/g, "\\'")}')">Del</button>
            </div>
        </div>
    `).join('');
}

function openSpecialModal(id) {
    document.getElementById('specialId').value = '';
    document.getElementById('specialTitle').value = '';
    document.getElementById('specialDesc').value = '';
    document.getElementById('specialDay').value = '';
    document.getElementById('specialActive').checked = true;
    document.getElementById('specialModalTitle').textContent = 'Add Special';
    document.getElementById('specialModal').classList.add('visible');
}

function editSpecial(id) {
    const s = specials.find(sp => sp.id === id);
    if (!s) return;
    document.getElementById('specialId').value = s.id;
    document.getElementById('specialTitle').value = s.title;
    document.getElementById('specialDesc').value = s.description || '';
    document.getElementById('specialDay').value = s.day_of_week || '';
    document.getElementById('specialActive').checked = !!s.active;
    document.getElementById('specialModalTitle').textContent = 'Edit Special';
    document.getElementById('specialModal').classList.add('visible');
}

function closeSpecialModal() {
    document.getElementById('specialModal').classList.remove('visible');
}

async function saveSpecial() {
    const id = document.getElementById('specialId').value;
    const title = document.getElementById('specialTitle').value.trim();

    if (!title) {
        showToast('Title is required');
        return;
    }

    const payload = {
        title,
        description: document.getElementById('specialDesc').value.trim() || null,
        day_of_week: document.getElementById('specialDay').value || null,
        active: document.getElementById('specialActive').checked ? 1 : 0,
    };

    try {
        const url = id
            ? `${API_BASE}/api/admin/specials/${id}`
            : `${API_BASE}/api/admin/specials`;

        const resp = await fetch(url, {
            method: id ? 'PUT' : 'POST',
            headers: apiHeaders(),
            body: JSON.stringify(payload),
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || 'Save failed');
        }

        closeSpecialModal();
        showToast(id ? 'Special updated' : 'Special created');
        loadSpecials();
    } catch (err) {
        showToast(err.message);
    }
}

async function deleteSpecial(id, title) {
    if (!confirm(`Delete "${title}"?`)) return;

    try {
        const resp = await fetch(`${API_BASE}/api/admin/specials/${id}`, {
            method: 'DELETE',
            headers: apiHeaders(),
        });

        if (resp.status === 401) { doLogout(); return; }
        if (!resp.ok) throw new Error('Delete failed');

        showToast('Special deleted');
        loadSpecials();
    } catch (err) {
        showToast(err.message);
    }
}

// ── PIN Change ───────────────────────────────────────────────

async function changePin(type) {
    const currentEl = document.getElementById(`${type}CurrentPin`);
    const newEl = document.getElementById(`${type}NewPin`);
    const statusId = `${type}PinStatus`;

    const currentPin = currentEl.value;
    const newPin = newEl.value;

    if (!currentPin) {
        showStatus(statusId, 'Enter current PIN', 'error');
        return;
    }
    if (!newPin || newPin.length < 4) {
        showStatus(statusId, 'New PIN must be 4-8 characters', 'error');
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/admin/change-pin`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({
                pin_type: type,
                current_pin: currentPin,
                new_pin: newPin,
            }),
        });

        if (resp.status === 401) { doLogout(); return; }

        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Change failed');

        currentEl.value = '';
        newEl.value = '';
        showStatus(statusId, `${type === 'store' ? 'Store' : 'Admin'} PIN changed!`, 'success');
        showToast('PIN changed');
    } catch (err) {
        showStatus(statusId, err.message, 'error');
    }
}

// ── Utility ──────────────────────────────────────────────────

function showStatus(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = `save-status ${type}`;
    setTimeout(() => { el.className = 'save-status'; }, 4000);
}

let toastTimer;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

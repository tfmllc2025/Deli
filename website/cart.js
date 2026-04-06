// ============================================================
// CartManager — Quickstop Super Deli Cart System
//
// Stores cart in localStorage as JSON array. Shared by menu.html
// and order.html. Each cart item has:
//   { id, item_name, item_type, base_price, quantity,
//     customizations, special_instructions, line_total }
//
// All prices in dollars (display); converted to cents for API.
// ============================================================

class CartManager {
    constructor() {
        this.STORAGE_KEY = 'qsd_cart';
        this.listeners = [];
        this.items = this._load();
    }

    // ── Persistence ─────────────────────────────────────────

    _load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    _save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));
        this._notify();
    }

    // ── Event System ────────────────────────────────────────

    onChange(callback) {
        this.listeners.push(callback);
    }

    _notify() {
        const summary = this.getSummary();
        this.listeners.forEach(fn => fn(summary));
    }

    // ── Cart Operations ─────────────────────────────────────

    addItem(item) {
        // item: { item_name, item_type, base_price, customizations, special_instructions, line_total }
        const cartItem = {
            id: 'cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            item_name: item.item_name,
            item_type: item.item_type || null,
            base_price: item.base_price,
            quantity: 1,
            customizations: item.customizations || null,
            special_instructions: item.special_instructions || '',
            line_total: item.line_total || item.base_price,
        };
        this.items.push(cartItem);
        this._save();
        return cartItem;
    }

    removeItem(id) {
        this.items = this.items.filter(i => i.id !== id);
        this._save();
    }

    updateItem(id, updates) {
        const item = this.items.find(i => i.id === id);
        if (!item) return null;
        item.customizations = updates.customizations || null;
        item.special_instructions = updates.special_instructions || '';
        // Recalculate line_total: new unit price * existing quantity
        const unitPrice = updates.line_total || updates.base_price || item.base_price;
        item.line_total = +(unitPrice * item.quantity).toFixed(2);
        this._save();
        return item;
    }

    updateQuantity(id, quantity) {
        const item = this.items.find(i => i.id === id);
        if (!item) return;
        quantity = Math.max(0, Math.min(20, quantity));
        if (quantity === 0) {
            this.removeItem(id);
            return;
        }
        // line_total per unit = line_total / old quantity
        const unitPrice = item.line_total / item.quantity;
        item.quantity = quantity;
        item.line_total = +(unitPrice * quantity).toFixed(2);
        this._save();
    }

    clear() {
        this.items = [];
        this._save();
    }

    getItems() {
        return [...this.items];
    }

    getSummary() {
        const count = this.items.reduce((sum, i) => sum + i.quantity, 0);
        const subtotal = this.items.reduce((sum, i) => sum + i.line_total, 0);
        return { count, subtotal: +subtotal.toFixed(2), items: this.items.length };
    }

    isEmpty() {
        return this.items.length === 0;
    }

    // ── Format for API ──────────────────────────────────────

    toApiPayload() {
        return this.items.map(item => ({
            item_name: item.item_name,
            item_type: item.item_type,
            quantity: item.quantity,
            customizations: item.customizations,
            special_instructions: item.special_instructions,
        }));
    }

    // ── Display Helpers ─────────────────────────────────────

    getCustomizationSummary(item) {
        if (!item.customizations) return '';
        const parts = [];
        for (const [section, selected] of Object.entries(item.customizations)) {
            if (Array.isArray(selected)) {
                selected.forEach(s => parts.push(s.value));
            } else if (selected && selected.value) {
                parts.push(selected.value);
            }
        }
        return parts.join(', ');
    }
}

// Global singleton
const cart = new CartManager();

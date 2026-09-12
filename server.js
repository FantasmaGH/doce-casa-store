require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sharp = require('sharp');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const WA_INTERNAL_TOKEN = String(process.env.WA_INTERNAL_TOKEN || '').trim();
if (JWT_SECRET.length < 32) throw new Error('JWT_SECRET ausente ou inseguro. Configure um segredo com pelo menos 32 caracteres no .env.');
if (WA_INTERNAL_TOKEN.length < 24) throw new Error('WA_INTERNAL_TOKEN ausente ou inseguro. Configure um token com pelo menos 24 caracteres no .env.');
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_IMAGE_MB = Number(process.env.IMAGE_MAX_MB || 5);
const WA_INTERNAL_URL = process.env.WA_INTERNAL_URL || 'http://127.0.0.1:4174';


fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'store.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL DEFAULT 0,
    vendor_price_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    stock_qty REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL NOT NULL DEFAULT 1,
    availability TEXT NOT NULL DEFAULT 'ready',
    lead_time_days INTEGER NOT NULL DEFAULT 0,
    image_path TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_price_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    min_qty REAL NOT NULL,
    max_qty REAL,
    price_cents INTEGER NOT NULL,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'outros',
    expense_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS payables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creditor TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'outros',
    due_date TEXT NOT NULL,
    recurrence TEXT NOT NULL DEFAULT 'none',
    status TEXT NOT NULL DEFAULT 'pending',
    paid_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT NOT NULL DEFAULT '',
    shipping_postal_code TEXT NOT NULL DEFAULT '',
    shipping_address TEXT NOT NULL DEFAULT '',
    shipping_city TEXT NOT NULL DEFAULT '',
    shipping_state TEXT NOT NULL DEFAULT '',
    shipping_notes TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'a_combinar',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'pending',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    shipping_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'site',
    notes TEXT NOT NULL DEFAULT '',
    inventory_committed INTEGER NOT NULL DEFAULT 0,
    picking_status TEXT NOT NULL DEFAULT 'waiting',
    assigned_vendor TEXT NOT NULL DEFAULT '',
    assigned_driver TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL DEFAULT 'not_assigned',
    route_position INTEGER,
    delivery_notes TEXT NOT NULL DEFAULT '',
    delivered_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    name_snapshot TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    unit_vendor_price_cents INTEGER NOT NULL DEFAULT 0,
    unit_cost_cents INTEGER NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    delivery_date TEXT NOT NULL DEFAULT '',
    payment_due_date TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS campaign_products (
    campaign_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    PRIMARY KEY (campaign_id, product_id),
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL, campaign_id INTEGER, product_id INTEGER NOT NULL, quantity REAL NOT NULL, unit_cost_cents INTEGER NOT NULL, purchase_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ordered', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL, FOREIGN KEY(product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS campaign_product_plans (
    campaign_id INTEGER NOT NULL, product_id INTEGER NOT NULL, safety_pct REAL NOT NULL DEFAULT 0, expected_unit_cost_cents INTEGER NOT NULL DEFAULT 0, supplier_id INTEGER, produced_qty REAL NOT NULL DEFAULT 0, wasted_qty REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (campaign_id, product_id), FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE, FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    can_sell INTEGER NOT NULL DEFAULT 0,
    can_pick INTEGER NOT NULL DEFAULT 0,
    can_deliver INTEGER NOT NULL DEFAULT 0,
    can_view_financial INTEGER NOT NULL DEFAULT 0,
    can_manage_products INTEGER NOT NULL DEFAULT 0,
    can_attend INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS public_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_access_codes (
    order_id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type TEXT NOT NULL,
    actor_id INTEGER,
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL,
    order_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    assigned_staff_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL,
    FOREIGN KEY(assigned_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS order_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_id INTEGER,
    actor_name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS order_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    access_code TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    requested_json TEXT NOT NULL DEFAULT '{}',
    recalculated_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewed_by) REFERENCES staff_users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS order_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'a_combinar',
    status TEXT NOT NULL DEFAULT 'pending',
    due_date TEXT,
    paid_at TEXT,
    failed_at TEXT,
    refunded_at TEXT,
    reference TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS order_payment_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    change_request_id INTEGER,
    kind TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    paid_at TEXT,
    refunded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY(change_request_id) REFERENCES order_change_requests(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_payment_adjustments_order ON order_payment_adjustments(order_id, id);
  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    direction TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_id INTEGER,
    sender_name TEXT NOT NULL DEFAULT '',
    message_type TEXT NOT NULL DEFAULT 'text',
    body TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_history(order_id, id);
  CREATE INDEX IF NOT EXISTS idx_order_changes_order ON order_change_requests(order_id, id);
  CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id, id);
  CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, id);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('orders', 'picking_status', "TEXT NOT NULL DEFAULT 'waiting'");
ensureColumn('orders', 'assigned_vendor', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'assigned_driver', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'delivery_status', "TEXT NOT NULL DEFAULT 'not_assigned'");
ensureColumn('orders', 'route_position', 'INTEGER');
ensureColumn('orders', 'delivery_notes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'delivered_at', 'TEXT');
ensureColumn('orders', 'salesperson_id', 'INTEGER');
ensureColumn('orders', 'picker_id', 'INTEGER');
ensureColumn('orders', 'driver_id', 'INTEGER');
ensureColumn('orders', 'approved_by', 'INTEGER');
ensureColumn('orders', 'approved_at', 'TEXT');
ensureColumn('orders', 'payment_due_date', 'TEXT');
ensureColumn('orders', 'payment_paid_at', 'TEXT');
ensureColumn('orders', 'payment_reminder_sent_at', 'TEXT');
ensureColumn('products', 'vendor_price_cents', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('order_items', 'unit_vendor_price_cents', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('public_links', 'requested_by_staff_id', 'INTEGER');
ensureColumn('public_links', 'requested_by_phone', "TEXT NOT NULL DEFAULT ''");
ensureColumn('campaigns', 'payment_due_date', "TEXT NOT NULL DEFAULT ''");
db.exec(`CREATE TABLE IF NOT EXISTS campaign_public_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campaign_public_links_campaign ON campaign_public_links(campaign_id);
CREATE TABLE IF NOT EXISTS campaign_order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_order_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL DEFAULT 'customer',
  actor_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(campaign_order_id) REFERENCES campaign_orders(id) ON DELETE CASCADE
);`);
ensureColumn('staff_users', 'can_attend', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('staff_users', 'can_approve_customers', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('staff_users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, preferred_name TEXT NOT NULL, referrer_name TEXT NOT NULL DEFAULT '', referrer_phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'approved', approved_by_staff_id INTEGER, approved_at TEXT, rejected_by_staff_id INTEGER, rejected_at TEXT, rejection_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(approved_by_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL, FOREIGN KEY(rejected_by_staff_id) REFERENCES staff_users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS customer_registration_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, step TEXT NOT NULL DEFAULT 'preferred_name', preferred_name TEXT NOT NULL DEFAULT '', referrer_name TEXT NOT NULL DEFAULT '', referrer_phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
// Existing customers with order history remain registered so the new gate does not break current clientele.
db.prepare(`INSERT OR IGNORE INTO customers (phone, preferred_name, status, approved_at) SELECT customer_phone, MAX(customer_name), 'approved', CURRENT_TIMESTAMP FROM orders WHERE length(replace(replace(replace(replace(customer_phone,' ',''),'-',''),'(',''),')','')) >= 8 GROUP BY customer_phone`).run();
ensureColumn('orders', 'campaign_id', 'INTEGER');
ensureColumn('expenses', 'campaign_id', 'INTEGER');
ensureColumn('stock_movements', 'campaign_id', 'INTEGER');

// Campanhas possuem catálogo próprio, separado dos produtos da venda direta.
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_catalog_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'un',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL DEFAULT 0,
    min_qty REAL NOT NULL DEFAULT 0,
    available_qty REAL,
    availability_status TEXT NOT NULL DEFAULT 'waiting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    order_number TEXT NOT NULL UNIQUE,
    access_code TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    paid_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    delivery_status TEXT NOT NULL DEFAULT 'waiting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_order_id INTEGER NOT NULL,
    campaign_product_id INTEGER NOT NULL,
    name_snapshot TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'un',
    quantity REAL NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    availability_status TEXT NOT NULL DEFAULT 'waiting',
    available_qty REAL,
    FOREIGN KEY(campaign_order_id) REFERENCES campaign_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(campaign_product_id) REFERENCES campaign_catalog_products(id)
  );
  CREATE INDEX IF NOT EXISTS idx_campaign_catalog_products_campaign ON campaign_catalog_products(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_campaign_orders_campaign ON campaign_orders(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_campaign_order_items_order ON campaign_order_items(campaign_order_id);
`);
ensureColumn('campaign_orders', 'customer_number', "TEXT NOT NULL DEFAULT ''");
ensureColumn('campaign_orders', 'customer_address', "TEXT NOT NULL DEFAULT ''");
ensureColumn('campaign_orders', 'payment_date', 'TEXT');
ensureColumn('campaign_orders', 'production_started_at', 'TEXT');
ensureColumn('campaign_orders', 'refund_pending_cents', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('expenses', 'active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('purchases', 'stock_applied_qty', 'REAL NOT NULL DEFAULT 0');
ensureColumn('notifications', 'idempotency_key', 'TEXT');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL");
db.exec(`INSERT INTO order_payments (order_id, amount_cents, method, status, due_date)
  SELECT o.id, o.total_cents, o.payment_method, o.payment_status, o.payment_due_date
  FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_payments p WHERE p.order_id=o.id);
INSERT INTO order_history (order_id, action, after_json, actor_type, actor_name)
  SELECT o.id, 'legacy_import', json_object('status', o.status, 'paymentStatus', o.payment_status, 'totalCents', o.total_cents), 'system', 'migração V6.5'
  FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_history h WHERE h.order_id=o.id);`);

function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) return;
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email, hash);
    console.log(`Administrador inicial criado: ${email}`);
  }
}
seedAdmin();

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `produto-${Date.now()}`;
}

function uniqueSlug(name, currentId = null) {
  const base = slugify(name);
  let candidate = base;
  let counter = 2;
  while (true) {
    const found = db.prepare('SELECT id FROM products WHERE slug = ?').get(candidate);
    if (!found || found.id === currentId) return candidate;
    candidate = `${base}-${counter++}`;
  }
}

function cents(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  const raw = String(value).replace(/R\$\s?/gi, '').trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function money(centsValue) {
  return Number(centsValue || 0) / 100;
}

function priceTiersForProduct(productId, includeCost = true) {
  return db.prepare('SELECT id, min_qty AS minQty, max_qty AS maxQty, price_cents AS priceCents, cost_cents AS costCents FROM product_price_tiers WHERE product_id = ? ORDER BY min_qty ASC, id ASC').all(productId).map(tier => ({
    id: tier.id,
    minQty: Number(tier.minQty),
    maxQty: tier.maxQty === null ? null : Number(tier.maxQty),
    price: money(tier.priceCents),
    priceCents: tier.priceCents,
    ...(includeCost ? { cost: money(tier.costCents), costCents: tier.costCents } : {})
  }));
}

function normalizePriceTiers(input, fallbackCostCents) {
  if (!Array.isArray(input)) return [];
  const fallback = Math.max(0, Number(fallbackCostCents) || 0);
  const tiers = input.map(row => ({
    minQty: Number(String(row.minQty ?? '').replace(',', '.')),
    maxQty: row.maxQty === null || row.maxQty === '' || row.maxQty === undefined ? null : Number(String(row.maxQty).replace(',', '.')),
    priceCents: Math.max(0, row.priceCents !== undefined ? Number(row.priceCents) || 0 : cents(row.price)),
    costCents: Math.max(0, row.costCents !== undefined ? Number(row.costCents) || 0 : (row.cost !== undefined ? cents(row.cost) : fallback))
  })).filter(row => Number.isFinite(row.minQty) && row.minQty > 0 && (row.maxQty === null || (Number.isFinite(row.maxQty) && row.maxQty >= row.minQty)));
  tiers.sort((a, b) => a.minQty - b.minQty);
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    if (previous.maxQty !== null && tiers[index].minQty <= previous.maxQty) throw new Error('As faixas de preço não podem se sobrepor.');
  }
  return tiers;
}

function priceForQuantity(product, quantity) {
  const tiers = priceTiersForProduct(product.id);
  const match = tiers.filter(tier => quantity >= tier.minQty && (tier.maxQty === null || quantity <= tier.maxQty)).sort((a, b) => b.minQty - a.minQty)[0];
  return match ? { priceCents: match.priceCents, costCents: match.costCents } : { priceCents: product.price_cents, costCents: product.cost_cents };
}

function replacePriceTiers(productId, input, fallbackCost) {
  const tiers = normalizePriceTiers(input, fallbackCost);
  db.prepare('DELETE FROM product_price_tiers WHERE product_id = ?').run(productId);
  const insert = db.prepare('INSERT INTO product_price_tiers (product_id, min_qty, max_qty, price_cents, cost_cents) VALUES (?, ?, ?, ?, ?)');
  tiers.forEach(tier => insert.run(productId, tier.minQty, tier.maxQty, tier.priceCents, tier.costCents));
  return tiers;
}

function productView(row, includePrivate = false) {
  if (!row) return null;
  const priceTiers = priceTiersForProduct(row.id, includePrivate);
  if (!row) return null;
  const result = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    price: money(row.price_cents),
    priceCents: row.price_cents,
    startingPrice: priceTiers.length ? priceTiers[0].price : money(row.price_cents),
    priceTiers,
    stockQty: Number(row.stock_qty),
    lowStockThreshold: Number(row.low_stock_threshold),
    availability: row.availability,
    leadTimeDays: row.lead_time_days,
    imageUrl: row.image_path ? `/media/${row.image_path}` : null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includePrivate) {
    result.cost = money(row.cost_cents);
    result.costCents = row.cost_cents;
    result.vendorPrice = money(row.vendor_price_cents);
    result.vendorPriceCents = row.vendor_price_cents;
  }
  return result;
}

function payableView(row) {
  if (!row) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${row.due_date}T00:00:00`);
  const daysUntilDue = Math.ceil((due - today) / 86400000);
  return { ...row, amount: money(row.amount_cents), daysUntilDue, overdue: row.status === 'pending' && daysUntilDue < 0, paid: row.status === 'paid' };
}

function orderView(order) {
  if (!order) return null;
  const items = db.prepare(`
    SELECT id, product_id AS productId, name_snapshot AS name, quantity,
           unit_price_cents AS unitPriceCents, unit_vendor_price_cents AS unitVendorPriceCents, unit_cost_cents AS unitCostCents
    FROM order_items WHERE order_id = ? ORDER BY id
  `).all(order.id).map(item => ({
    ...item,
    unitPrice: money(item.unitPriceCents),
    unitVendorPrice: money(item.unitVendorPriceCents),
    unitCost: money(item.unitCostCents),
    vendorMargin: money(Math.max(0, item.unitPriceCents - item.unitVendorPriceCents)),
    companyGrossMargin: money(Math.max(0, item.unitVendorPriceCents - item.unitCostCents)),
    lineTotalCents: Math.round(item.quantity * item.unitPriceCents),
    lineTotal: money(Math.round(item.quantity * item.unitPriceCents))
  }));
  return {
    ...order,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    paymentStatus: order.payment_status,
    status: order.status,
    subtotal: money(order.subtotal_cents),
    shipping: money(order.shipping_cents),
    total: money(order.total_cents),
    paymentDueDate: order.payment_due_date || null,
    paymentPaidAt: order.payment_paid_at || null,
    inventoryCommitted: Boolean(order.inventory_committed),
    history: orderTimeline(order.id),
    payments: paymentTimeline(order.id),
    paymentAdjustments: paymentAdjustmentView(order.id),
    items
  };
}

function authTokenFromRequest(req) {
  return req.cookies.store_admin || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function requireAdmin(req, res, next) {
  const token = authTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.cookies.store_admin) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const expected = `${req.protocol}://${req.get('host')}`;
    if ((origin && origin !== expected) || (referer && !referer.startsWith(`${expected}/`))) return res.status(403).json({ error: 'Origem não autorizada.' });
  }
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada.' });
  }
}

function requireWhatsAppInternal(req, res, next) {
  if (req.get('x-wa-internal-token') !== WA_INTERNAL_TOKEN) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

function setAuthCookie(res, admin) {
  const token = jwt.sign({ sub: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('store_admin', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function makeOrderAccessCode() { return `COD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function makeToken() { return crypto.randomBytes(18).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function staffByPhone(phone) { return db.prepare('SELECT * FROM staff_users WHERE phone = ? AND active = 1').get(normalizePhone(phone)); }
function logAudit(actorType, actorId, actorName, action, entityType, entityId, details = {}) {
  db.prepare('INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(actorType, actorId || null, actorName || '', action, entityType, entityId || null, JSON.stringify(details));
}
function queueNotification(phone, type, payload = {}, idempotencyKey = null) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) return;
  const payloadJson = JSON.stringify(payload);
  const key = idempotencyKey || crypto.createHash('sha256').update(`${normalized}|${type}|${payloadJson}`).digest('hex');
  db.prepare('INSERT OR IGNORE INTO notifications (phone, type, payload_json, idempotency_key) VALUES (?, ?, ?, ?)').run(normalized, type, payloadJson, key);
}
function recordOrderHistory(orderId, action, before = {}, after = {}, actor = {}, reason = '') {
  db.prepare('INSERT INTO order_history (order_id, action, before_json, after_json, actor_type, actor_id, actor_name, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Number(orderId), action, JSON.stringify(before || {}), JSON.stringify(after || {}), actor.type || 'system', actor.id || null, actor.name || '', reason || '');
}
function recordSupportMessage(ticketId, direction, senderType, senderId, senderName, body, messageType = 'text', deliveryStatus = 'received') {
  if (!String(body || '').trim()) return;
  db.prepare('INSERT INTO support_messages (ticket_id, direction, sender_type, sender_id, sender_name, message_type, body, delivery_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Number(ticketId), direction, senderType, senderId || null, senderName || '', messageType, String(body), deliveryStatus);
}
function queueStaffNotification(permission, type, payload = {}) {
  const column = permission === 'attend' ? 'can_attend' : permission === 'pick' ? 'can_pick' : permission === 'deliver' ? 'can_deliver' : permission === 'sell' ? 'can_sell' : permission === 'approve_customers' ? 'can_approve_customers' : null;
  if (!column) return;
  const staff = db.prepare(`SELECT phone FROM staff_users WHERE active = 1 AND ${column} = 1`).all();
  staff.forEach(item => queueNotification(item.phone, type, payload));
}
function orderSellerFromCatalogAccess(req) {
  const raw = catalogAccessFromRequest(req);
  if (!raw) return null;
  return db.prepare("SELECT requested_by_staff_id AS staffId FROM public_links WHERE token_hash = ? AND used_at IS NOT NULL AND expires_at > datetime('now')").get(hashToken(raw))?.staffId || null;
}
function catalogLinkHours() { return Math.max(1 / 60, Number(process.env.CATALOG_LINK_TTL_HOURS || 0.5)); }
function publicBaseUrl(req) { return String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
function catalogAccessFromRequest(req) { return req.cookies.catalog_access || String(req.get('x-catalog-access') || ''); }
function validCatalogAccess(req) {
  const raw = catalogAccessFromRequest(req);
  if (!raw) return false;
  const row = db.prepare("SELECT id FROM public_links WHERE token_hash = ? AND used_at IS NOT NULL AND expires_at > datetime('now')").get(hashToken(raw));
  return Boolean(row);
}
function requireCatalogAccess(req, res, next) {
  if (String(process.env.REQUIRE_CATALOG_LINK || 'false').toLowerCase() !== 'true') return next();
  if (!validCatalogAccess(req)) return res.status(403).json({ error: 'Acesso ao catálogo expirado. Solicite um novo link.' });
  next();
}
function campaignLinkHours() { return Math.max(1 / 60, Number(process.env.CAMPAIGN_LINK_TTL_HOURS || process.env.CATALOG_LINK_TTL_HOURS || 24)); }
function campaignAccessFromRequest(req) { return req.cookies.campaign_access || String(req.get('x-campaign-access') || ''); }
function validCampaignAccess(req) {
  const raw = campaignAccessFromRequest(req);
  if (!raw) return false;
  return Boolean(db.prepare("SELECT id FROM campaign_public_links WHERE token_hash=? AND used_at IS NOT NULL AND expires_at > datetime('now')").get(hashToken(raw)));
}
function requireCampaignAccess(req,res,next) {
  if (!validCampaignAccess(req)) return res.status(403).json({error:'Acesso à campanha expirado. Solicite um novo link.'});
  next();
}
function campaignAccessCookie(res, token) { res.cookie('campaign_access', token, {httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:Math.round(campaignLinkHours()*3600000),path:'/'}); }

function nextOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PED-${date}-${suffix}`;
}

function nextCampaignOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CAM-${date}-${suffix}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error('Envie uma imagem JPG, PNG ou WebP.'));
    }
    cb(null, true);
  }
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/media', requireCatalogAccess, express.static(UPLOADS_DIR, { maxAge: '1d', fallthrough: false }));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'doce-casa-store' }));

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const key = `${req.ip || 'unknown'}:${String(req.body?.email || '').trim().toLowerCase()}`;
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  if (recent.length >= 8) return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde alguns minutos.' });
  req.loginAttemptKey = key;
  req.loginRecent = recent;
  next();
}
function recordLoginFailure(req) {
  if (req.loginAttemptKey) loginAttempts.set(req.loginAttemptKey, [...(req.loginRecent || []), Date.now()].slice(-20));
}
function clearLoginFailures(req) { if (req.loginAttemptKey) loginAttempts.delete(req.loginAttemptKey); }



app.post('/api/auth/login', loginRateLimit, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    recordLoginFailure(req);
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  clearLoginFailures(req);
  setAuthCookie(res, admin);
  res.json({ ok: true, admin: { id: admin.id, email: admin.email } });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('store_admin');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ admin: { id: req.admin.sub, email: req.admin.email } });
});

app.get('/api/admin/staff', requireAdmin, (_req, res) => {
  const staff = db.prepare('SELECT id, name, phone, active, can_sell AS canSell, can_pick AS canPick, can_deliver AS canDeliver, can_view_financial AS canViewFinancial, can_manage_products AS canManageProducts, can_attend AS canAttend, can_approve_customers AS canApproveCustomers, is_admin AS isAdmin, created_at AS createdAt, updated_at AS updatedAt FROM staff_users ORDER BY active DESC, name COLLATE NOCASE').all();
  res.json({ staff });
});

app.post('/api/admin/staff', requireAdmin, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = normalizePhone(body.phone);
  if (!name || phone.length < 8) return res.status(400).json({ error: 'Informe nome e telefone válido.' });
  try {
    const result = db.prepare('INSERT INTO staff_users (name, phone, can_sell, can_pick, can_deliver, can_view_financial, can_manage_products, can_attend, can_approve_customers, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(name, phone, body.canSell ? 1 : 0, body.canPick ? 1 : 0, body.canDeliver ? 1 : 0, body.canViewFinancial ? 1 : 0, body.canManageProducts ? 1 : 0, body.canAttend ? 1 : 0, body.canApproveCustomers ? 1 : 0, body.isAdmin ? 1 : 0);
    logAudit('admin', req.admin?.sub, req.admin?.email, 'staff_created', 'staff', result.lastInsertRowid, { name, phone });
    res.status(201).json({ staff: db.prepare('SELECT * FROM staff_users WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) { res.status(409).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Este telefone já está cadastrado.' : error.message }); }
});

app.patch('/api/admin/staff/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const body = req.body || {};
  const name = String(body.name ?? current.name).trim();
  const phone = normalizePhone(body.phone ?? current.phone);
  db.prepare('UPDATE staff_users SET name = ?, phone = ?, active = ?, can_sell = ?, can_pick = ?, can_deliver = ?, can_view_financial = ?, can_manage_products = ?, can_attend = ?, can_approve_customers = ?, is_admin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, phone, body.active === undefined ? current.active : (body.active ? 1 : 0), body.canSell === undefined ? current.can_sell : (body.canSell ? 1 : 0), body.canPick === undefined ? current.can_pick : (body.canPick ? 1 : 0), body.canDeliver === undefined ? current.can_deliver : (body.canDeliver ? 1 : 0), body.canViewFinancial === undefined ? current.can_view_financial : (body.canViewFinancial ? 1 : 0), body.canManageProducts === undefined ? current.can_manage_products : (body.canManageProducts ? 1 : 0), body.canAttend === undefined ? current.can_attend : (body.canAttend ? 1 : 0), body.canApproveCustomers === undefined ? current.can_approve_customers : (body.canApproveCustomers ? 1 : 0), body.isAdmin === undefined ? current.is_admin : (body.isAdmin ? 1 : 0), id);
  logAudit('admin', req.admin?.sub, req.admin?.email, 'staff_updated', 'staff', id, { name, phone });
  res.json({ staff: db.prepare('SELECT * FROM staff_users WHERE id = ?').get(id) });
});

function customerByPhone(phone) { return db.prepare('SELECT * FROM customers WHERE phone = ?').get(normalizePhone(phone)); }
function staffCanApprove(staff) { return !!(staff && staff.active && (staff.is_admin || staff.can_approve_customers)); }
function customerRegistrationView(row) { return row ? { id: row.id, phone: row.phone, preferredName: row.preferred_name, referrerName: row.referrer_name, referrerPhone: row.referrer_phone, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at, rejectedAt: row.rejected_at, rejectionReason: row.rejection_reason } : null; }

app.get('/api/internal/customer-registration', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const customer = customerByPhone(phone);
  const session = db.prepare('SELECT phone, step, preferred_name AS preferredName, referrer_name AS referrerName, referrer_phone AS referrerPhone FROM customer_registration_sessions WHERE phone=?').get(phone);
  res.json({ customer: customerRegistrationView(customer), session: session || null });
});
app.post('/api/internal/customer-registration/start', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone.length < 8) return res.status(400).json({error:'Número inválido.'});
  const existing = customerByPhone(phone);
  if (existing?.status === 'approved' || existing?.status === 'pending') return res.json({ customer: customerRegistrationView(existing) });
  db.prepare(`INSERT INTO customer_registration_sessions (phone,step,preferred_name,referrer_name,referrer_phone) VALUES (?,'preferred_name','','','') ON CONFLICT(phone) DO UPDATE SET step='preferred_name',preferred_name='',referrer_name='',referrer_phone='',updated_at=CURRENT_TIMESTAMP`).run(phone);
  res.json({ok:true});
});
app.post('/api/internal/customer-registration/answer', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const field = String(req.body?.field || '');
  const value = String(req.body?.value || '').trim();

  const session = db.prepare('SELECT * FROM customer_registration_sessions WHERE phone=?').get(phone);
  if (!session) return res.status(404).json({ error: 'Cadastro não iniciado.' });

  const allowed = {
    preferred_name: 'referrer_name',
    referrer_name: 'referrer_phone',
    referrer_phone: 'review'
  };

  if (session.step !== field || !allowed[field] || !value) {
    return res.status(400).json({ error: 'Etapa de cadastro inválida.' });
  }

  if (field === 'preferred_name') {
    if (value.length < 2) return res.status(400).json({ error: 'Nome inválido.' });
    db.prepare("UPDATE customer_registration_sessions SET preferred_name=?,step='referrer_name',updated_at=CURRENT_TIMESTAMP WHERE phone=?")
      .run(value, phone);
    return res.json({ ok: true, step: 'referrer_name' });
  }

  if (field === 'referrer_name') {
    if (value.length < 2) return res.status(400).json({ error: 'Nome do indicador inválido.' });
    db.prepare("UPDATE customer_registration_sessions SET referrer_name=?,step='referrer_phone',updated_at=CURRENT_TIMESTAMP WHERE phone=?")
      .run(value, phone);
    return res.json({ ok: true, step: 'referrer_phone' });
  }

  if (field === 'referrer_phone') {
    const refPhone = normalizePhone(value);
    if (refPhone.length < 8) return res.status(400).json({ error: 'Telefone inválido.' });

    db.prepare("UPDATE customer_registration_sessions SET referrer_phone=?,step='review',updated_at=CURRENT_TIMESTAMP WHERE phone=?")
      .run(refPhone, phone);

    const current = db.prepare('SELECT * FROM customer_registration_sessions WHERE phone=?').get(phone);

    return res.json({
      status: 'review',
      session: {
        phone: current.phone,
        step: current.step,
        preferredName: current.preferred_name,
        referrerName: current.referrer_name,
        referrerPhone: current.referrer_phone
      }
    });
  }

  res.json({ ok: true });
});

app.post('/api/internal/customer-registration/set-step', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const step = String(req.body?.step || '');

  const allowedSteps = ['preferred_name', 'referrer_name', 'referrer_phone', 'review', 'correction'];
  if (!allowedSteps.includes(step)) return res.status(400).json({ error: 'Etapa inválida.' });

  const session = db.prepare('SELECT * FROM customer_registration_sessions WHERE phone=?').get(phone);
  if (!session) return res.status(404).json({ error: 'Cadastro não iniciado.' });

  db.prepare("UPDATE customer_registration_sessions SET step=?,updated_at=CURRENT_TIMESTAMP WHERE phone=?")
    .run(step, phone);

  res.json({ ok: true, step });
});

app.post('/api/internal/customer-registration/confirm', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const session = db.prepare('SELECT * FROM customer_registration_sessions WHERE phone=?').get(phone);

  if (!session) return res.status(404).json({ error: 'Cadastro não iniciado.' });
  if (session.step !== 'review') return res.status(400).json({ error: 'Cadastro ainda não está na etapa de confirmação.' });

  const preferredName = String(session.preferred_name || '').trim();
  const referrerName = String(session.referrer_name || '').trim();
  const referrerPhone = normalizePhone(session.referrer_phone);

  if (preferredName.length < 2) return res.status(400).json({ error: 'Nome inválido.' });
  if (referrerName.length < 2) return res.status(400).json({ error: 'Nome do indicador inválido.' });
  if (referrerPhone.length < 8) return res.status(400).json({ error: 'Telefone do indicador inválido.' });

  db.prepare(`
    INSERT INTO customers(
      phone, preferred_name, referrer_name, referrer_phone, status
    )
    VALUES(?,?,?,?, 'pending')
    ON CONFLICT(phone) DO UPDATE SET
      preferred_name=excluded.preferred_name,
      referrer_name=excluded.referrer_name,
      referrer_phone=excluded.referrer_phone,
      status='pending',
      approved_by_staff_id=NULL,
      approved_at=NULL,
      rejected_by_staff_id=NULL,
      rejected_at=NULL,
      rejection_reason='',
      updated_at=CURRENT_TIMESTAMP
  `).run(phone, preferredName, referrerName, referrerPhone);

  const customer = db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);

  db.prepare('DELETE FROM customer_registration_sessions WHERE phone=?').run(phone);

  logAudit(
    'customer',
    null,
    preferredName,
    'customer_registration_submitted',
    'customer',
    customer.id,
    { phone, referrerName, referrerPhone }
  );

  queueStaffNotification(
    'approve_customers',
    'new_customer_registration',
    {
      registrationId: customer.id,
      name: preferredName,
      phone,
      referrerName,
      referrerPhone
    }
  );

  res.json({
    status: 'pending',
    customer: customerRegistrationView(customer)
  });
});

app.post('/api/internal/customer-registration/reset', requireWhatsAppInternal, (req,res) => {
  const phone = normalizePhone(req.body?.phone);
  db.prepare('DELETE FROM customer_registration_sessions WHERE phone=?').run(phone);
  db.prepare("DELETE FROM customers WHERE phone=? AND status='rejected'").run(phone);
  res.json({ok:true});
});

app.get('/api/admin/customer-registrations', requireAdmin, (req, res) => {
  const status = ['pending','approved','rejected'].includes(String(req.query.status || 'pending')) ? String(req.query.status || 'pending') : 'pending';
  const rows = db.prepare("SELECT c.*, s1.name AS approved_by_name, s2.name AS rejected_by_name FROM customers c LEFT JOIN staff_users s1 ON s1.id=c.approved_by_staff_id LEFT JOIN staff_users s2 ON s2.id=c.rejected_by_staff_id WHERE c.status=? ORDER BY c.updated_at DESC LIMIT 300").all(status);
  res.json({ customers: rows.map(row => ({ ...customerRegistrationView(row), approvedByName: row.approved_by_name || '', rejectedByName: row.rejected_by_name || '' })) });
});
app.post('/api/admin/customer-registrations/:id/decision', requireAdmin, (req, res) => {
  const id = Number(req.params.id), decision = String(req.body?.decision || '').toLowerCase();
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Decisão inválida.' });
  const row = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Cadastro não encontrado.' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Este cadastro já foi decidido.' });
  const reason = String(req.body?.reason || '').trim();
  if (decision === 'approved') db.prepare("UPDATE customers SET status='approved', approved_by_staff_id=NULL, approved_at=CURRENT_TIMESTAMP, rejected_by_staff_id=NULL, rejected_at=NULL, rejection_reason='', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  else db.prepare("UPDATE customers SET status='rejected', rejected_by_staff_id=NULL, rejected_at=CURRENT_TIMESTAMP, rejection_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reason, id);
  db.prepare('DELETE FROM customer_registration_sessions WHERE phone=?').run(row.phone);
  logAudit('admin', req.admin?.sub, req.admin?.email, `customer_${decision}`, 'customer', id, { phone: row.phone, preferredName: row.preferred_name, referrerName: row.referrer_name, referrerPhone: row.referrer_phone, reason });
  queueNotification(row.phone, `customer_registration_${decision}`, { name: row.preferred_name, reason });
  res.json({ customer: customerRegistrationView(db.prepare('SELECT * FROM customers WHERE id=?').get(id)) });
});

app.get('/api/internal/customer-registrations/pending', requireWhatsAppInternal, (_req, res) => {
  const rows = db.prepare("SELECT id, phone, preferred_name, referrer_name, referrer_phone, created_at FROM customers WHERE status='pending' ORDER BY created_at ASC LIMIT 100").all();
  res.json({ customers: rows.map(customerRegistrationView) });
});
app.post('/api/internal/customer-registrations/decision', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.body?.phone), id = Number(req.body?.registrationId), decision = String(req.body?.decision || '').toLowerCase(), reason = String(req.body?.reason || '').trim();
  if (!staffCanApprove(staff)) return res.status(403).json({ error: 'Você não possui permissão para aprovar ou rejeitar cadastros.' });
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Decisão inválida.' });
  const row = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Cadastro não encontrado.' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Este cadastro já foi decidido.' });
  if (decision === 'approved') db.prepare("UPDATE customers SET status='approved', approved_by_staff_id=?, approved_at=CURRENT_TIMESTAMP, rejected_by_staff_id=NULL, rejected_at=NULL, rejection_reason='', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,id);
  else db.prepare("UPDATE customers SET status='rejected', rejected_by_staff_id=?, rejected_at=CURRENT_TIMESTAMP, rejection_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,reason,id);
  db.prepare('DELETE FROM customer_registration_sessions WHERE phone=?').run(row.phone);
  logAudit('staff', staff.id, staff.name, `customer_${decision}`, 'customer', id, { phone: row.phone, preferredName: row.preferred_name, referrerName: row.referrer_name, referrerPhone: row.referrer_phone, reason });
  queueNotification(row.phone, `customer_registration_${decision}`, { name: row.preferred_name, reason });
  res.json({ ok: true, customer: customerRegistrationView(db.prepare('SELECT * FROM customers WHERE id=?').get(id)) });
});

app.get('/api/admin/catalog-links', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT l.id, l.expires_at AS expiresAt, l.used_at AS usedAt, l.created_at AS createdAt, s.name AS salespersonName FROM public_links l LEFT JOIN staff_users s ON s.id=l.requested_by_staff_id ORDER BY id DESC LIMIT 100').all();
  res.json({ links: rows.map(row => ({ ...row, status: row.usedAt ? (new Date(row.expiresAt) > new Date() ? 'used' : 'expired') : (new Date(row.expiresAt) > new Date() ? 'available' : 'expired') })) });
});

app.post('/api/admin/catalog-links', requireAdmin, (req, res) => {
  const token = makeToken();
  const expiresAt = new Date(Date.now() + catalogLinkHours() * 3600000).toISOString();
  db.prepare('INSERT INTO public_links (token_hash, expires_at, requested_by_phone) VALUES (?, ?, ?)').run(hashToken(token), expiresAt, 'admin');
  logAudit('admin', req.admin?.sub, req.admin?.email, 'catalog_link_created', 'public_link', null, { expiresAt });
  res.status(201).json({ url: `${publicBaseUrl(req)}/catalogo/${token}`, expiresAt, singleUse: true });
});

app.post('/api/internal/catalog-links', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone.length < 8) return res.status(400).json({ error: 'Número do cliente inválido.' });
  const staff = req.body?.staffId ? db.prepare('SELECT * FROM staff_users WHERE id = ? AND active = 1').get(Number(req.body.staffId)) : staffByPhone(phone);
  if (req.body?.staffId && (!staff || !staff.can_sell)) return res.status(403).json({ error: 'Vendedor não autorizado.' });
  const token = makeToken();
  const expiresAt = new Date(Date.now() + catalogLinkHours() * 3600000).toISOString();
  db.prepare('INSERT INTO public_links (token_hash, expires_at, requested_by_phone, requested_by_staff_id) VALUES (?, ?, ?, ?)').run(hashToken(token), expiresAt, phone, staff?.can_sell ? staff.id : null);
  res.status(201).json({ url: `${publicBaseUrl(req)}/catalogo/${token}`, expiresAt, singleUse: true, requestedByPhone: phone, salesperson: staff?.can_sell ? { id: staff.id, name: staff.name } : null });
});

app.delete('/api/admin/catalog-links/:id', requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE public_links SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP), expires_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Link não encontrado.' });
  res.json({ ok: true });
});

app.get('/api/admin/staff/summary', requireAdmin, (_req, res) => {
  const summary = db.prepare(`SELECT COALESCE(s.name, 'Não atribuído') AS name, COUNT(o.id) AS orders, COALESCE(SUM(o.total_cents), 0) AS totalCents FROM orders o LEFT JOIN staff_users s ON s.id = o.salesperson_id GROUP BY o.salesperson_id ORDER BY totalCents DESC`).all().map(row => ({ name: row.name, orders: row.orders, total: money(row.totalCents) }));
  res.json({ summary });
});

app.get('/api/public/config', requireCatalogAccess, (_req, res) => {
  res.json({
    storeName: process.env.STORE_NAME || 'Minha Loja de Doces',
    whatsapp: process.env.STORE_WHATSAPP || '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || ''
  });
});

app.get('/api/public/products', requireCatalogAccess, (_req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
  res.json({ products: products.map(row => productView(row, false)) });
});

app.get('/api/public/campaigns', requireCatalogAccess, (_req, res) => {
  const campaigns = db.prepare("SELECT * FROM campaigns WHERE active = 1 AND end_date >= date('now') ORDER BY start_date ASC, id DESC").all().map(campaignPublicView);
  res.json({ campaigns });
});

app.get('/api/internal/campaigns', requireWhatsAppInternal, (_req, res) => {
  const campaigns = db.prepare("SELECT * FROM campaigns WHERE active = 1 AND end_date >= date('now') ORDER BY start_date ASC, id DESC").all().map(campaignView);
  res.json({ campaigns });
});

app.get('/api/internal/staff/identity', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.query.phone);
  if (!staff) return res.status(404).json({ error: 'Número não cadastrado como equipe.' });
  res.json({ staff: { id: staff.id, name: staff.name, phone: staff.phone, canSell: Boolean(staff.can_sell), canPick: Boolean(staff.can_pick), canDeliver: Boolean(staff.can_deliver), canViewFinancial: Boolean(staff.can_view_financial), canManageProducts: Boolean(staff.can_manage_products), canAttend: Boolean(staff.can_attend), canApproveCustomers: Boolean(staff.can_approve_customers), isAdmin: Boolean(staff.is_admin) } });
});

app.get('/api/internal/staff/orders', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.query.phone);
  if (!staff) return res.status(403).json({ error: 'Número não autorizado.' });
  const filters = []; const params = [];
  if (staff.can_pick) { filters.push("(o.picking_status IN ('waiting','separating','blocked') OR o.picker_id = ?)"); params.push(staff.id); }
  if (staff.can_deliver) { filters.push("(o.delivery_status IN ('queued','route','failed') OR o.driver_id = ?)"); params.push(staff.id); }
  if (staff.can_sell) { filters.push('o.salesperson_id = ?'); params.push(staff.id); }
  if (!filters.length) return res.json({ orders: [] });
  const rows = db.prepare(`SELECT o.id, o.order_number AS orderNumber, o.customer_name AS customerName, o.customer_phone AS customerPhone, o.shipping_postal_code AS postalCode, o.shipping_address AS address, o.shipping_city AS city, o.shipping_state AS state, o.shipping_notes AS shippingNotes, o.total_cents AS totalCents, o.status, o.payment_status AS paymentStatus, o.picking_status AS pickingStatus, o.delivery_status AS deliveryStatus, o.salesperson_id AS salespersonId, o.picker_id AS pickerId, o.driver_id AS driverId FROM orders o WHERE (${filters.join(' OR ')}) AND o.status <> 'cancelled' ORDER BY o.created_at ASC LIMIT 100`).all(...params);
  res.json({ orders: rows.map(row => ({ ...row, total: money(row.totalCents) })) });
});
app.get('/api/internal/staff/products', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.query.phone);
  if (!staff || !staff.can_sell) return res.status(403).json({ error: 'Sem permissão de vendas.' });
  const rows = db.prepare("SELECT * FROM products WHERE active = 1 AND availability != 'unavailable' ORDER BY name COLLATE NOCASE").all();
  const tierStmt = db.prepare("SELECT min_qty AS minQty, max_qty AS maxQty, price_cents AS priceCents FROM product_price_tiers WHERE product_id = ? ORDER BY min_qty ASC");
  res.json({
    products: rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      vendorPrice: money(row.vendor_price_cents),
      clientPrice: money(row.price_cents),
      priceTiers: tierStmt.all(row.id).map(tier => ({
        minQty: Number(tier.minQty),
        maxQty: tier.maxQty == null ? null : Number(tier.maxQty),
        price: money(tier.priceCents)
      })),
      stockQty: Number(row.stock_qty),
      availability: row.availability,
      leadTimeDays: row.lead_time_days
    }))
  });
});
app.get('/api/internal/staff/financial-summary', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.query.phone);
  if (!staff || !staff.can_view_financial) return res.status(403).json({ error: 'Sem permissão financeira.' });
  const sales = db.prepare("SELECT COALESCE(SUM(total_cents),0) totalCents, COUNT(*) orders FROM orders WHERE status!='cancelled' AND (payment_status='paid' OR status='delivered')").get();
  const cost = db.prepare("SELECT COALESCE(SUM(oi.quantity*oi.unit_cost_cents),0) costCents FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' AND (o.payment_status='paid' OR o.status='delivered')").get();
  const expenses = db.prepare('SELECT COALESCE(SUM(amount_cents),0) expensesCents FROM expenses WHERE active = 1').get();
  res.json({ orders:Number(sales.orders), revenue:money(sales.totalCents), cost:money(cost.costCents), expenses:money(expenses.expensesCents), result:money(Number(sales.totalCents)-Number(cost.costCents)-Number(expenses.expensesCents)) });
});
app.get('/api/internal/staff/sales-summary', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.query.phone);
  if (!staff || !staff.can_sell) return res.status(403).json({ error: 'Sem permissão de vendas.' });
  const r = db.prepare(`SELECT COUNT(DISTINCT o.id) orders, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) salesCents, COALESCE(SUM(oi.quantity * oi.unit_vendor_price_cents),0) vendorCents, COALESCE(SUM(oi.quantity * (oi.unit_price_cents - oi.unit_vendor_price_cents)),0) marginCents FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.salesperson_id=? AND o.status!='cancelled'`).get(staff.id);
  res.json({ name: staff.name, orders: Number(r.orders), sales: money(r.salesCents), vendorValue: money(r.vendorCents), margin: money(r.marginCents) });
});
app.patch('/api/internal/staff/orders/:id/status', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.body?.phone || req.query.phone); const id = Number(req.params.id); const action = String(req.body?.action || '').toLowerCase();
  if (!staff) return res.status(403).json({ error: 'Número não autorizado.' });
  const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (action === 'assumir') {
    if (staff.can_pick && ['waiting','separating','blocked'].includes(current.picking_status)) {
      if (current.picker_id && current.picker_id !== staff.id) return res.status(409).json({ error: 'A separação já foi assumida por outro funcionário.' });
      db.prepare("UPDATE orders SET picking_status='separating', picker_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,id);
      recordOrderHistory(id, 'picking_claimed', { pickingStatus: current.picking_status }, { pickingStatus: 'separating' }, { type:'staff', id:staff.id, name:staff.name });
      logAudit('staff', staff.id, staff.name, 'picking_claimed', 'order', id, {});
    } else if (staff.can_deliver && ['queued','route','failed'].includes(current.delivery_status)) {
      if (current.driver_id && current.driver_id !== staff.id) return res.status(409).json({ error: 'A entrega já foi assumida por outro funcionário.' });
      db.prepare("UPDATE orders SET delivery_status='route', driver_id=?, assigned_driver=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id, staff.name, id);
      logAudit('staff', staff.id, staff.name, 'delivery_claimed', 'order', id, {});
    } else if (staff.can_sell && !current.salesperson_id) {
      db.prepare('UPDATE orders SET salesperson_id=?, assigned_vendor=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(staff.id, staff.name, id);
      logAudit('staff', staff.id, staff.name, 'sale_claimed', 'order', id, {});
    } else return res.status(403).json({ error: 'Você não pode assumir este pedido nesta etapa.' });
  } else if (action === 'separar') {
    if (!staff.can_pick) return res.status(403).json({ error: 'Este usuário não pode separar pedidos.' });
    if (current.picker_id && current.picker_id !== staff.id) return res.status(409).json({ error: 'A separação já foi assumida por outro funcionário.' });
    db.prepare("UPDATE orders SET picking_status='separating', picker_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,id);
    recordOrderHistory(id, 'picking_started', { pickingStatus: current.picking_status }, { pickingStatus: 'separating' }, { type:'staff', id:staff.id, name:staff.name });
    logAudit('staff', staff.id, staff.name, 'picking_started', 'order', id, {});
  } else if (action === 'separado') {
    if (!staff.can_pick) return res.status(403).json({ error: 'Este usuário não pode separar pedidos.' });
    if (current.picker_id && current.picker_id !== staff.id) return res.status(409).json({ error: 'A separação pertence a outro funcionário.' });
    db.prepare("UPDATE orders SET picking_status='separated', picker_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,id);
    queueStaffNotification('deliver','new_delivery',{orderNumber:current.order_number, customerName:current.customer_name, customerPhone:current.customer_phone, address:current.shipping_address, city:current.shipping_city, state:current.shipping_state, postalCode:current.shipping_postal_code, shippingNotes:current.shipping_notes, total:money(current.total_cents), paymentStatus:current.payment_status});
    recordOrderHistory(id, 'picking_completed', { pickingStatus: current.picking_status }, { pickingStatus: 'separated' }, { type:'staff', id:staff.id, name:staff.name });
    queueNotification(current.customer_phone, 'order_status', { orderNumber:current.order_number, status:'separated', label:'pedido separado' }, `order:${id}:picking:separated`);
    logAudit('staff', staff.id, staff.name, 'picking_completed', 'order', id, {});
  } else if (action === 'entregar') {
    if (!staff.can_deliver) return res.status(403).json({ error: 'Este usuário não pode atualizar entregas.' });
    if (current.driver_id && current.driver_id !== staff.id) return res.status(409).json({ error: 'A entrega pertence a outro funcionário.' });
    db.prepare("UPDATE orders SET delivery_status='route', driver_id=?, assigned_driver=?, status=CASE WHEN status='confirmed' THEN 'shipped' ELSE status END, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,staff.name,id);
    queueNotification(current.customer_phone,'order_status',{orderNumber:current.order_number,status:'shipped',label:'saiu para entrega'}, `order:${id}:delivery:shipped`);
    recordOrderHistory(id, 'delivery_started', { deliveryStatus: current.delivery_status }, { deliveryStatus: 'route', status: 'shipped' }, { type:'staff', id:staff.id, name:staff.name });
    logAudit('staff', staff.id, staff.name, 'delivery_started', 'order', id, {});
  } else if (action === 'entregue') {
    if (!staff.can_deliver) return res.status(403).json({ error: 'Este usuário não pode atualizar entregas.' });
    if (current.driver_id && current.driver_id !== staff.id) return res.status(409).json({ error: 'A entrega pertence a outro funcionário.' });
    db.prepare("UPDATE orders SET delivery_status='delivered', driver_id=?, assigned_driver=?, delivered_at=COALESCE(delivered_at,CURRENT_TIMESTAMP), status='delivered', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id,staff.name,id);
    queueNotification(current.customer_phone,'order_status',{orderNumber:current.order_number,status:'delivered',label:'entregue'}, `order:${id}:delivery:delivered`);
    recordOrderHistory(id, 'delivery_completed', { deliveryStatus: current.delivery_status, status: current.status }, { deliveryStatus: 'delivered', status: 'delivered' }, { type:'staff', id:staff.id, name:staff.name });
    logAudit('staff', staff.id, staff.name, 'delivery_completed', 'order', id, {});
  } else return res.status(400).json({ error: 'Ação inválida.' });
  res.json({ ok: true, order: orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(id)) });
});

function findOrderByAccess(orderNumber, accessCode, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 8) return null;
  if (accessCode) return db.prepare("SELECT o.* FROM orders o JOIN order_access_codes c ON c.order_id=o.id WHERE c.code=? AND replace(replace(replace(replace(o.customer_phone,' ',''),'-',''),'(',''),')','')=?").get(String(accessCode).toUpperCase(), normalizedPhone);
  if (orderNumber) return db.prepare("SELECT * FROM orders WHERE order_number=? AND replace(replace(replace(replace(customer_phone,' ',''),'-',''),'(',''),')','')=?").get(String(orderNumber).toUpperCase(), normalizedPhone);
  return null;
}
function orderTimeline(orderId) {
  return db.prepare('SELECT id, action, before_json AS beforeJson, after_json AS afterJson, actor_type AS actorType, actor_name AS actorName, reason, created_at AS createdAt FROM order_history WHERE order_id=? ORDER BY id ASC').all(orderId).map(row => ({ ...row, before: JSON.parse(row.beforeJson || '{}'), after: JSON.parse(row.afterJson || '{}') }));
}
function paymentTimeline(orderId) {
  const payments = db.prepare('SELECT id, amount_cents AS amountCents, method, status, due_date AS dueDate, paid_at AS paidAt, failed_at AS failedAt, refunded_at AS refundedAt, reference, notes, created_at AS createdAt FROM order_payments WHERE order_id=? ORDER BY id ASC').all(orderId).map(row => ({ ...row, amount: money(row.amountCents) }));
  const adjustments = db.prepare('SELECT id, kind, amount_cents AS amountCents, status, reason, due_date AS dueDate, paid_at AS paidAt, refunded_at AS refundedAt, created_at AS createdAt FROM order_payment_adjustments WHERE order_id=? ORDER BY id ASC').all(orderId).map(row => ({ ...row, amount: money(row.amountCents) }));
  return payments;
}
function recordPaymentAdjustment(orderId, changeRequestId, kind, amountCents, reason, dueDate = null) {
  const amount = Math.abs(Number(amountCents) || 0);
  if (!amount) return null;
  const result = db.prepare('INSERT INTO order_payment_adjustments (order_id, change_request_id, kind, amount_cents, status, reason, due_date) VALUES (?, ?, ?, ?, \'pending\', ?, ?)').run(orderId, changeRequestId || null, kind, amount, reason || '', dueDate || null);
  return Number(result.lastInsertRowid);
}
function paymentAdjustmentView(orderId) {
  return db.prepare('SELECT id, kind, amount_cents AS amountCents, status, reason, due_date AS dueDate, paid_at AS paidAt, refunded_at AS refundedAt, created_at AS createdAt FROM order_payment_adjustments WHERE order_id=? ORDER BY id ASC').all(orderId).map(row => ({ ...row, amount: money(row.amountCents) }));
}
function publicOrderView(order) {
  const view = orderView(order);
  return { orderNumber: order.order_number, accessCode: db.prepare('SELECT code FROM order_access_codes WHERE order_id=?').get(order.id)?.code, customerName: order.customer_name, status: order.status, pickingStatus: order.picking_status, deliveryStatus: order.delivery_status, paymentStatus: order.payment_status, paymentDueDate: order.payment_due_date || null, paymentPaidAt: order.payment_paid_at || null, total: money(order.total_cents), createdAt: order.created_at, updatedAt: order.updated_at, nextStep: order.status === 'pending' ? 'Aguardando confirmação' : order.status === 'confirmed' ? 'Aguardando separação' : order.status === 'preparing' ? 'Separação em andamento' : order.status === 'shipped' ? 'Em entrega' : order.status === 'delivered' ? 'Pedido concluído' : order.status === 'cancelled' ? 'Pedido cancelado' : order.status, items: view.items.map(item => ({ name: item.name, quantity: item.quantity })), timeline: orderTimeline(order.id), payments: paymentTimeline(order.id), paymentAdjustments: paymentAdjustmentView(order.id) };
}
app.get('/api/public/order-status', (req, res) => {
  const order = findOrderByAccess(req.query.number, req.query.code, req.query.phone);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado com esse código.' });
  res.json({ order: publicOrderView(order) });
});
app.post('/api/public/orders/:number/change-requests', (req, res) => {
  const body = req.body || {};
  const order = findOrderByAccess(req.params.number, body.code, body.phone);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado com esse código.' });
  if (order.status === 'cancelled' || order.status === 'delivered' || order.inventory_committed || !['waiting','separating'].includes(order.picking_status)) return res.status(409).json({ error: 'Este pedido não pode mais ser alterado nesta etapa.' });
  const requestedItems = Array.isArray(body.items) ? body.items.map(item => ({ productId: Number(item.productId), quantity: Number(item.quantity) })).filter(item => Number.isInteger(item.productId) && Number.isFinite(item.quantity) && item.quantity > 0) : null;
  if (requestedItems && !requestedItems.length) return res.status(400).json({ error: 'Informe pelo menos um item válido.' });
  const requested = { items: requestedItems, shipping: body.shipping || null, notes: body.notes === undefined ? null : String(body.notes) };
  const request = db.prepare('INSERT INTO order_change_requests (order_id, access_code, customer_phone, requested_json, reason) VALUES (?, ?, ?, ?, ?)').run(order.id, String(body.code || '').toUpperCase(), normalizePhone(body.phone), JSON.stringify(requested), String(body.reason || 'Solicitação do cliente'));
  recordOrderHistory(order.id, 'change_requested', { status: order.status }, { requestId: request.lastInsertRowid, requested }, { type: 'customer', name: order.customer_name });
  queueStaffNotification('pick', 'order_change_requested', { orderNumber: order.order_number, customerName: order.customer_name, requestId: request.lastInsertRowid });
  queueNotification(order.customer_phone, 'order_change_received', { orderNumber: order.order_number });
  res.status(201).json({ requestId: request.lastInsertRowid, status: 'pending', message: 'Solicitação recebida e encaminhada para análise.' });
});
app.get('/api/admin/order-change-requests', requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT r.*, o.order_number, o.customer_name, o.customer_phone, o.status AS order_status FROM order_change_requests r JOIN orders o ON o.id=r.order_id WHERE r.status='pending' ORDER BY r.id ASC LIMIT 200`).all().map(row => ({ ...row, requested: JSON.parse(row.requested_json || '{}'), recalculated: JSON.parse(row.recalculated_json || '{}') }));
  res.json({ requests: rows });
});
app.patch('/api/admin/order-change-requests/:id', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT r.*, o.* FROM order_change_requests r JOIN orders o ON o.id=r.order_id WHERE r.id=? AND r.status=\'pending\'').get(Number(req.params.id));
  if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  const decision = String(req.body?.decision || '').toLowerCase();
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Decisão inválida.' });
  const requested = JSON.parse(request.requested_json || '{}');
  if (decision === 'rejected') {
    db.prepare("UPDATE order_change_requests SET status='rejected', reviewed_by=NULL, reviewed_at=CURRENT_TIMESTAMP, reason=? WHERE id=?").run(String(req.body.reason || 'Alteração rejeitada'), request.id);
    recordOrderHistory(request.order_id, 'change_rejected', { requestId: request.id }, { requestId: request.id, status: 'rejected' }, { type: 'admin', id: req.admin?.sub, name: req.admin?.email }, String(req.body.reason || ''));
    queueNotification(request.customer_phone, 'order_change_rejected', { orderNumber: request.order_number });
    return res.json({ ok: true, status: 'rejected' });
  }
  const requestedItems = Array.isArray(requested.items) && requested.items.length
    ? requested.items
    : db.prepare('SELECT product_id AS productId, quantity FROM order_items WHERE order_id=?').all(request.order_id);
  if (!requestedItems.length) return res.status(400).json({ error: 'O pedido não possui itens para recalcular.' });
  const normalized = [];
  for (const item of requestedItems) {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.productId);
    if (!product) return res.status(409).json({ error: 'Produto indisponível na alteração.' });
    if (product.availability === 'ready' && Number(product.stock_qty) < item.quantity) return res.status(409).json({ error: `Estoque insuficiente para ${product.name}.` });
    normalized.push({ product, quantity: item.quantity, pricing: priceForQuantity(product, item.quantity) });
  }
  const subtotal = normalized.reduce((sum, item) => sum + Math.round(item.quantity * item.pricing.priceCents), 0);
  const shipping = requested.shipping || {};
  const shippingCents = requested.shipping ? Math.max(0, cents(requested.shipping.shippingCents || 0)) : request.shipping_cents;
  const total = subtotal + shippingCents;
  const oldTotal = Number(request.total_cents || 0);
  const paidCents = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS total FROM order_payments WHERE order_id=? AND status='paid'").get(request.order_id).total || 0);
  const delta = total - oldTotal;
  const adjustmentKind = delta > 0 ? 'additional_payment' : delta < 0 && paidCents > 0 ? 'refund' : null;
  const adjustmentAmount = Math.abs(delta);
  const adjustmentDueDate = String(req.body?.paymentDueDate || '').trim() || null;
  db.transaction(() => {
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(request.order_id);
    const insert = db.prepare('INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price_cents, unit_vendor_price_cents, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?)');
    normalized.forEach(item => insert.run(request.order_id, item.product.id, item.product.name, item.quantity, item.pricing.priceCents, item.product.vendor_price_cents, item.pricing.costCents));
    const nextPaymentStatus = adjustmentKind === 'additional_payment' ? 'partial' : request.payment_status;
    db.prepare("UPDATE orders SET subtotal_cents=?, shipping_cents=?, total_cents=?, payment_status=?, payment_due_date=CASE WHEN ? IS NOT NULL THEN ? ELSE payment_due_date END, shipping_address=COALESCE(?, shipping_address), shipping_city=COALESCE(?, shipping_city), shipping_state=COALESCE(?, shipping_state), shipping_postal_code=COALESCE(?, shipping_postal_code), shipping_notes=COALESCE(?, shipping_notes), notes=COALESCE(?, notes), updated_at=CURRENT_TIMESTAMP WHERE id=?").run(subtotal, shippingCents, total, nextPaymentStatus, adjustmentDueDate, adjustmentDueDate, shipping.address || null, shipping.city || null, shipping.state || null, shipping.postalCode || null, shipping.notes || null, requested.notes, request.order_id);
    if (!adjustmentKind && request.payment_status !== 'paid') db.prepare("UPDATE order_payments SET amount_cents=?, due_date=COALESCE(?,due_date), updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('pending','failed')").run(total, adjustmentDueDate, request.order_id);
    let adjustmentId = null;
    if (adjustmentKind && adjustmentAmount) adjustmentId = recordPaymentAdjustment(request.order_id, request.id, adjustmentKind, adjustmentAmount, adjustmentKind === 'refund' ? 'Estorno gerado por redução do pedido' : 'Diferença gerada por aumento do pedido', adjustmentDueDate);
    db.prepare("UPDATE order_change_requests SET status='approved', recalculated_json=?, reviewed_by=NULL, reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify({ subtotalCents: subtotal, shippingCents, totalCents: total, oldTotalCents: oldTotal, deltaCents: delta, adjustmentId, adjustmentKind }), request.id);
  })();
  recordOrderHistory(request.order_id, 'change_approved', { totalCents: request.total_cents }, { totalCents: total, requestId: request.id }, { type: 'admin', id: req.admin?.sub, name: req.admin?.email });
  queueNotification(request.customer_phone, 'order_change_approved', { orderNumber: request.order_number, total: money(total), delta: money(delta), adjustmentKind });
  if (adjustmentKind === 'additional_payment') queueNotification(request.customer_phone, 'payment_difference_due', { orderNumber: request.order_number, amount: money(adjustmentAmount), dueDate: adjustmentDueDate }, `order:${request.order_id}:adjustment:${request.id}:due`);
  if (adjustmentKind === 'refund') queueNotification(request.customer_phone, 'refund_pending', { orderNumber: request.order_number, amount: money(adjustmentAmount) }, `order:${request.order_id}:adjustment:${request.id}:refund`);
  res.json({ ok: true, status: 'approved', order: orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(request.order_id)) });
});
app.get('/api/internal/order-status', requireWhatsAppInternal, (req, res) => {
  const order = findOrderByAccess(req.query.number, req.query.code, req.query.phone);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado com esse código.' });
  res.json({ order: publicOrderView(order) });
});

app.post('/api/public/orders', requireCatalogAccess, (req, res) => {
  const body = req.body || {};
  const customer = body.customer || {};
  const shipping = body.shipping || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!String(customer.name || '').trim() || !String(customer.phone || '').trim() || !items.length) {
    return res.status(400).json({ error: 'Informe nome, telefone e pelo menos um produto.' });
  }

  const normalizedItems = [];
  for (const raw of items) {
    const productId = Number(raw.productId);
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(productId) || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Produto ou quantidade inválida.' });
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
    if (!product) return res.status(400).json({ error: 'Um dos produtos não está mais disponível.' });
    if (product.availability === 'ready' && Number(product.stock_qty) < quantity) {
      return res.status(409).json({ error: `Estoque insuficiente para ${product.name}.` });
    }
    normalizedItems.push({ product, quantity });
  }

  const pricedItems = normalizedItems.map(item => ({ ...item, pricing: priceForQuantity(item.product, item.quantity) }));
  const subtotalCents = pricedItems.reduce((sum, item) => sum + Math.round(item.quantity * item.pricing.priceCents), 0);
  const shippingInput = body.shippingCents ?? 0;
  const shippingCents = typeof shippingInput === 'number' && Number.isInteger(shippingInput)
    ? Math.max(0, shippingInput)
    : Math.max(0, cents(shippingInput));
  const totalCents = subtotalCents + shippingCents;
  const salespersonId = orderSellerFromCatalogAccess(req);
  const today = new Date().toISOString().slice(0, 10);
  const requestedCampaignId = Number(body.campaignId || 0) || null;
  const campaignForOrder = requestedCampaignId
    ? db.prepare("SELECT id FROM campaigns WHERE id = ? AND active = 1 AND ? BETWEEN start_date AND end_date").get(requestedCampaignId, today)
    : db.prepare("SELECT id FROM campaigns WHERE active = 1 AND ? BETWEEN start_date AND end_date ORDER BY id DESC LIMIT 1").get(today);
  const campaignId = campaignForOrder?.id || null;
  if (salespersonId) {
    for (const item of pricedItems) {
      if (Number(item.product.vendor_price_cents) <= 0 || Number(item.product.vendor_price_cents) > Number(item.pricing.priceCents)) return res.status(409).json({ error: `Defina um preço de repasse válido para ${item.product.name} antes de vender por este link.` });
    }
  }
  const orderNumber = nextOrderNumber();
  const accessCode = makeOrderAccessCode();

  const createOrder = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO orders (
        order_number, customer_name, customer_phone, customer_email,
        shipping_postal_code, shipping_address, shipping_city, shipping_state,
        shipping_notes, payment_method, payment_status, status,
        subtotal_cents, shipping_cents, total_cents, source, notes, salesperson_id, campaign_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderNumber,
      String(customer.name).trim(),
      String(customer.phone).trim(),
      String(customer.email || '').trim(),
      String(shipping.postalCode || '').trim(),
      String(shipping.address || '').trim(),
      String(shipping.city || '').trim(),
      String(shipping.state || '').trim(),
      String(shipping.notes || '').trim(),
      String(body.paymentMethod || 'a_combinar'),
      subtotalCents,
      shippingCents,
      totalCents,
      salespersonId ? 'seller_link' : String(body.source || 'site'),
      String(body.notes || '').trim(),
      salespersonId || null,
      campaignId
    );
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price_cents, unit_vendor_price_cents, unit_cost_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of pricedItems) {
      insertItem.run(result.lastInsertRowid, item.product.id, item.product.name, item.quantity, item.pricing.priceCents, item.product.vendor_price_cents, item.pricing.costCents);
    }
    db.prepare('INSERT INTO order_access_codes (order_id, code) VALUES (?, ?)').run(result.lastInsertRowid, accessCode);
    return result.lastInsertRowid;
  });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(createOrder());
  recordOrderHistory(order.id, 'created', {}, { status: order.status, paymentStatus: order.payment_status, totalCents: order.total_cents }, { type: 'system', name: salespersonId ? (db.prepare('SELECT name FROM staff_users WHERE id = ?').get(salespersonId)?.name || '') : '' });
  db.prepare('INSERT OR IGNORE INTO order_payments (order_id, amount_cents, method, status, due_date) VALUES (?, ?, ?, ?, ?)').run(order.id, order.total_cents, order.payment_method, order.payment_status, order.payment_due_date || null);
  logAudit('system', null, salespersonId ? (db.prepare('SELECT name FROM staff_users WHERE id = ?').get(salespersonId)?.name || '') : '', 'order_created', 'order', order.id, { source: order.source, salespersonId });
  queueNotification(order.customer_phone, 'order_created', { orderNumber: order.order_number, total: money(order.total_cents) });
  if (salespersonId) queueNotification(db.prepare('SELECT phone FROM staff_users WHERE id = ?').get(salespersonId)?.phone, 'new_sale', { orderNumber: order.order_number, customerName: order.customer_name, total: money(order.total_cents) });
  res.status(201).json({ order: { ...orderView(order), accessCode, salespersonId } });
});

app.get('/api/admin/products', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY active DESC, name COLLATE NOCASE').all();
  res.json({ products: rows.map(row => productView(row, true)) });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome do produto é obrigatório.' });
  const availability = ['ready', 'made_to_order', 'unavailable'].includes(body.availability) ? body.availability : 'ready';
  const clientPriceCents = Math.max(0, cents(body.price));
  const vendorPriceCents = Math.max(0, cents(body.vendorPrice));
  const costCents = Math.max(0, cents(body.cost));
  if (vendorPriceCents > clientPriceCents) return res.status(400).json({ error: 'O preço de repasse não pode ser maior que o preço do cliente.' });
  if (costCents > vendorPriceCents && vendorPriceCents > 0) return res.status(400).json({ error: 'O custo não pode ser maior que o preço de repasse.' });
  const stockQty = Math.max(0, Number(body.stockQty || 0));
  const createProduct = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO products (name, slug, description, price_cents, vendor_price_cents, cost_cents, stock_qty, low_stock_threshold, availability, lead_time_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      uniqueSlug(name),
      String(body.description || '').trim(),
      clientPriceCents,
      vendorPriceCents,
      costCents,
      stockQty,
      Math.max(0, Number(body.lowStockThreshold || 1)),
      availability,
      Math.max(0, Math.floor(Number(body.leadTimeDays || 0)))
    );
    if (stockQty > 0) db.prepare(`INSERT INTO stock_movements (product_id, type, quantity, unit_cost_cents, note) VALUES (?, 'in', ?, ?, ?)`).run(result.lastInsertRowid, stockQty, Math.max(0, cents(body.cost)), 'Estoque inicial');
    return result.lastInsertRowid;
  });
  const productId = createProduct();
  replacePriceTiers(productId, body.priceTiers, cents(body.cost));
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  res.status(201).json({ product: productView(row, true) });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Produto não encontrado.' });
  const body = req.body || {};
  const name = String(body.name ?? current.name).trim();
  const availability = ['ready', 'made_to_order', 'unavailable'].includes(body.availability) ? body.availability : current.availability;
  const nextClientPrice = body.price === undefined ? current.price_cents : Math.max(0, cents(body.price));
  const nextVendorPrice = body.vendorPrice === undefined ? current.vendor_price_cents : Math.max(0, cents(body.vendorPrice));
  const nextCost = body.cost === undefined ? current.cost_cents : Math.max(0, cents(body.cost));
  if (nextVendorPrice > nextClientPrice) return res.status(400).json({ error: 'O preço de repasse não pode ser maior que o preço do cliente.' });
  if (nextVendorPrice > 0 && nextCost > nextVendorPrice) return res.status(400).json({ error: 'O custo não pode ser maior que o preço de repasse.' });
  db.prepare(`
    UPDATE products SET name = ?, slug = ?, description = ?, price_cents = ?, vendor_price_cents = ?, cost_cents = ?,
      low_stock_threshold = ?, availability = ?, lead_time_days = ?, active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    uniqueSlug(name, id),
    String(body.description ?? current.description).trim(),
    body.price === undefined ? current.price_cents : Math.max(0, cents(body.price)),
    body.vendorPrice === undefined ? current.vendor_price_cents : Math.max(0, cents(body.vendorPrice)),
    body.cost === undefined ? current.cost_cents : Math.max(0, cents(body.cost)),
    body.lowStockThreshold === undefined ? current.low_stock_threshold : Math.max(0, Number(body.lowStockThreshold)),
    availability,
    body.leadTimeDays === undefined ? current.lead_time_days : Math.max(0, Math.floor(Number(body.leadTimeDays))),
    body.active === undefined ? current.active : (body.active ? 1 : 0),
    id
  );
  if (Array.isArray(body.priceTiers)) replacePriceTiers(id, body.priceTiers, body.cost === undefined ? current.cost_cents : cents(body.cost));
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product: productView(row, true) });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('UPDATE products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json({ ok: true });
});

app.post('/api/admin/products/:id/image', requireAdmin, upload.single('image'), async (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Produto não encontrado.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Imagem não recebida.' });
  const publicFilename = `${path.parse(req.file.filename).name}.webp`;
  const publicPath = path.join(UPLOADS_DIR, publicFilename);
  const storeName = String(process.env.STORE_NAME || 'Loja de Doces').replace(/[<&>]/g, '');
  try {
    const resized = await sharp(req.file.path).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
    const width = resized.info.width;
    const height = resized.info.height;
    const fontSize = Math.max(14, Math.round(Math.min(width, height) / 28));
    const watermark = Buffer.from(`<svg width="${width}" height="${height}"><style>text{font-family:Arial,sans-serif;font-size:${fontSize}px;font-weight:700;fill:#ffffff;letter-spacing:1px}</style><text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.18)}" transform="rotate(-32 ${Math.round(width * 0.05)} ${Math.round(height * 0.18)})">${storeName} · catálogo</text><text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.58)}" transform="rotate(-32 ${Math.round(width * 0.05)} ${Math.round(height * 0.58)})">${storeName} · catálogo</text><text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.98)}" transform="rotate(-32 ${Math.round(width * 0.05)} ${Math.round(height * 0.98)})">${storeName} · catálogo</text></svg>`);
    await sharp(resized.data).composite([{ input: watermark, opacity: 0.18 }]).webp({ quality: 82 }).toFile(publicPath);
    fs.unlinkSync(req.file.path);
  } catch (error) {
    console.error('[image] falha no processamento:', error.message);
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (fs.existsSync(publicPath)) fs.unlinkSync(publicPath);
    return res.status(400).json({ error: 'Não foi possível processar a imagem.' });
  }
  if (product.image_path) {
    const oldPath = path.join(UPLOADS_DIR, product.image_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.prepare('UPDATE products SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(publicFilename, id);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product: productView(row, true) });
});

app.delete('/api/admin/products/:id/image', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });
  if (product.image_path) {
    const imagePath = path.join(UPLOADS_DIR, product.image_path);
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }
  db.prepare('UPDATE products SET image_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/products/:id/stock', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });
  const type = ['in', 'out', 'adjustment'].includes(req.body.type) ? req.body.type : 'in';
  const quantity = Number(req.body.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'adjustment' && quantity === 0)) {
    return res.status(400).json({ error: 'Quantidade inválida.' });
  }
  const current = Number(product.stock_qty);
  const newStock = type === 'in' ? current + quantity : type === 'out' ? current - quantity : quantity;
  if (newStock < 0) return res.status(409).json({ error: 'O estoque não pode ficar negativo.' });
  const campaignId = Number(req.body.campaignId || 0) || null;
  const update = db.transaction(() => {
    db.prepare('UPDATE products SET stock_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStock, id);
    db.prepare(`INSERT INTO stock_movements (product_id, type, quantity, unit_cost_cents, note, campaign_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, type, quantity, Math.max(0, cents(req.body.unitCost)), String(req.body.note || '').trim(), campaignId
    );
  });
  update();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product: productView(row, true) });
});

app.get('/api/admin/stock/movements', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT m.*, p.name AS product_name
    FROM stock_movements m JOIN products p ON p.id = m.product_id
    ORDER BY m.id DESC LIMIT 200
  `).all();
  res.json({ movements: rows });
});

function commitInventory(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.inventory_committed) return;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const transaction = db.transaction(() => {
    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      if (!product || product.availability !== 'ready') continue;
      const result=db.prepare('UPDATE products SET stock_qty = stock_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock_qty >= ?').run(item.quantity, item.product_id, item.quantity);
      if(!result.changes) throw new Error(`Estoque insuficiente para ${product.name}.`);
      db.prepare(`INSERT INTO stock_movements (product_id, type, quantity, unit_cost_cents, note) VALUES (?, 'out', ?, ?, ?)`).run(
        item.product_id, item.quantity, item.unit_cost_cents, `Pedido ${order.order_number}`
      );
    }
    db.prepare('UPDATE orders SET inventory_committed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(orderId);
  });
  transaction();
}

app.get('/api/admin/operations/orders', requireAdmin, (req, res) => {
  const picking = ['waiting', 'separating', 'separated', 'blocked'].includes(req.query.picking) ? req.query.picking : null;
  const delivery = ['not_assigned', 'queued', 'route', 'delivered', 'failed'].includes(req.query.delivery) ? req.query.delivery : null;
  const clauses = ["status != 'cancelled'"];
  const params = [];
  if (picking) { clauses.push('picking_status = ?'); params.push(picking); }
  if (delivery) { clauses.push('delivery_status = ?'); params.push(delivery); }
  const rows = db.prepare(`SELECT * FROM orders WHERE ${clauses.join(' AND ')} ORDER BY CASE picking_status WHEN 'waiting' THEN 0 WHEN 'separating' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END, created_at ASC LIMIT 500`).all(...params);
  res.json({ orders: rows.map(orderView) });
});

app.patch('/api/admin/orders/:id/operations', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const picking = ['waiting', 'separating', 'separated', 'blocked'].includes(req.body.pickingStatus) ? req.body.pickingStatus : current.picking_status;
  const delivery = ['not_assigned', 'queued', 'route', 'delivered', 'failed'].includes(req.body.deliveryStatus) ? req.body.deliveryStatus : current.delivery_status;
  const deliveredAt = delivery === 'delivered' ? (current.delivered_at || new Date().toISOString()) : null;
  const vendorId = req.body.salespersonId === null || req.body.salespersonId === '' ? current.salesperson_id : (req.body.salespersonId === undefined ? current.salesperson_id : Number(req.body.salespersonId));
  const pickerId = req.body.pickerId === null || req.body.pickerId === '' ? current.picker_id : (req.body.pickerId === undefined ? current.picker_id : Number(req.body.pickerId));
  const driverId = req.body.driverId === null || req.body.driverId === '' ? current.driver_id : (req.body.driverId === undefined ? current.driver_id : Number(req.body.driverId));
  const vendor = vendorId ? db.prepare('SELECT * FROM staff_users WHERE id=? AND active=1').get(vendorId) : null;
  const picker = pickerId ? db.prepare('SELECT * FROM staff_users WHERE id=? AND active=1').get(pickerId) : null;
  const driver = driverId ? db.prepare('SELECT * FROM staff_users WHERE id=? AND active=1').get(driverId) : null;
  db.prepare('UPDATE orders SET picking_status = ?, salesperson_id = ?, picker_id = ?, driver_id = ?, assigned_vendor = ?, assigned_driver = ?, delivery_status = ?, route_position = ?, delivery_notes = ?, delivered_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(picking, vendorId || null, pickerId || null, driverId || null, vendor?.name || String(req.body.assignedVendor ?? current.assigned_vendor), driver?.name || String(req.body.assignedDriver ?? current.assigned_driver), delivery, req.body.routePosition === null || req.body.routePosition === undefined || req.body.routePosition === '' ? current.route_position : Number(req.body.routePosition), String(req.body.deliveryNotes ?? current.delivery_notes), deliveredAt, id);
  logAudit('admin', req.admin?.sub, req.admin?.email, 'operation_updated', 'order', id, { picking, delivery, salespersonId: vendorId, pickerId, driverId });
  if (picking === 'separated' && current.picking_status !== 'separated') { queueNotification(current.customer_phone, 'order_status', { orderNumber: current.order_number, status: 'preparing', label: 'pedido separado' }); queueStaffNotification('deliver', 'new_delivery', { orderNumber: current.order_number, customerName: current.customer_name }); }
  if (delivery === 'route' && current.delivery_status !== 'route') queueNotification(current.customer_phone, 'order_status', { orderNumber: current.order_number, status: 'shipped', label: 'saiu para entrega' });
  if (delivery === 'delivered' && current.delivery_status !== 'delivered') queueNotification(current.customer_phone, 'order_status', { orderNumber: current.order_number, status: 'delivered', label: 'entregue' });
  res.json({ order: orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)) });
});

app.post('/api/admin/routes/suggest', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.orderIds) ? req.body.orderIds.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ error: 'Informe os pedidos da rota.' });
  const placeholders = ids.map(() => '?').join(',');
  const orders = db.prepare(`SELECT * FROM orders WHERE id IN (${placeholders}) AND status != 'cancelled' ORDER BY shipping_state, shipping_city, shipping_postal_code, shipping_address`).all(...ids);
  const update = db.prepare('UPDATE orders SET delivery_status = \'queued\', route_position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const transaction = db.transaction(() => orders.forEach((order, index) => update.run(index + 1, order.id)));
  transaction();
  res.json({ route: orders.map((order, index) => ({ position: index + 1, order: orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) })) });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ orders: rows.map(orderView) });
});

app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json({ order: orderView(row) });
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const allowedStatus = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];
  const allowedPayment = ['pending', 'paid', 'refunded', 'failed'];
  const nextStatus = allowedStatus.includes(req.body.status) ? req.body.status : current.status;
  const nextPayment = allowedPayment.includes(req.body.paymentStatus) ? req.body.paymentStatus : current.payment_status;
  const requestedDueDate = req.body.paymentDueDate === undefined ? current.payment_due_date : String(req.body.paymentDueDate || '').trim();
  if (requestedDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDueDate)) return res.status(400).json({ error: 'Data de vencimento inválida.' });
  try {
    if (nextStatus === 'cancelled' && ['shipped','delivered'].includes(current.status)) return res.status(409).json({ error: 'Pedidos em entrega ou já entregues não podem ser cancelados. Use um fluxo de devolução/estorno.' });
    if (nextStatus === 'cancelled' && current.payment_status === 'paid' && nextPayment !== 'refunded') return res.status(409).json({ error: 'Pedido pago: registre o estorno antes de cancelar.' });
    db.transaction(() => {
      if (nextStatus !== 'cancelled' && ['confirmed', 'preparing', 'shipped', 'delivered'].includes(nextStatus) && !current.inventory_committed) commitInventory(id);
      if (nextStatus === 'cancelled' && current.inventory_committed) {
        const items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id);
        for(const item of items){db.prepare('UPDATE products SET stock_qty=stock_qty+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.quantity,item.product_id);db.prepare("INSERT INTO stock_movements(product_id,type,quantity,unit_cost_cents,note) VALUES(?, 'in', ?, ?, ?)").run(item.product_id,item.quantity,item.unit_cost_cents,`Estorno do pedido ${current.order_number}`);}
        db.prepare('UPDATE orders SET inventory_committed=0 WHERE id=?').run(id);
      }
      db.prepare('UPDATE orders SET status = ?, payment_status = ?, payment_due_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextStatus, nextPayment, requestedDueDate || null, req.body.notes === undefined ? current.notes : String(req.body.notes), id);
    })();
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  recordOrderHistory(id, 'status_changed', { status: current.status, paymentStatus: current.payment_status }, { status: nextStatus, paymentStatus: nextPayment }, { type: 'admin', id: req.admin?.sub, name: req.admin?.email }, String(req.body.reason || ''));
  if (nextPayment !== current.payment_status || requestedDueDate !== current.payment_due_date) {
    db.prepare(`UPDATE orders SET payment_paid_at = ${nextPayment === 'paid' ? 'COALESCE(payment_paid_at,CURRENT_TIMESTAMP)' : 'NULL'}, payment_reminder_sent_at = NULL WHERE id = ?`).run(id);
    db.prepare('INSERT OR IGNORE INTO order_payments (order_id, amount_cents, method, status, due_date) VALUES (?, ?, ?, ?, ?)').run(id, row.total_cents, row.payment_method, nextPayment, requestedDueDate || null);
    db.prepare('UPDATE order_payments SET status = ?, due_date = ?, paid_at = CASE WHEN ? = \'paid\' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status NOT IN (\'refunded\')').run(nextPayment, requestedDueDate || null, nextPayment, id);
  }
  logAudit('admin', req.admin?.sub, req.admin?.email, 'order_status_changed', 'order', id, { status: nextStatus, paymentStatus: nextPayment });
  const statusMessages = { confirmed: 'confirmado', preparing: 'em preparo', shipped: 'saiu para entrega', delivered: 'entregue', cancelled: 'cancelado' };
  if (statusMessages[nextStatus]) queueNotification(row.customer_phone, 'order_status', { orderNumber: row.order_number, status: nextStatus, label: statusMessages[nextStatus] });
  if (nextPayment === 'paid' && current.payment_status !== 'paid') queueNotification(row.customer_phone, 'payment_paid', { orderNumber: row.order_number, total: money(row.total_cents) }, `order:${id}:payment:paid`);
  if (nextStatus === 'confirmed' && current.status !== 'confirmed') queueStaffNotification('pick', 'new_picking', { orderNumber: row.order_number, customerName: row.customer_name });
  if (nextStatus === 'preparing') queueStaffNotification('pick', 'order_preparing', { orderNumber: row.order_number });
  res.json({ order: orderView(row) });
});

app.get('/api/admin/orders/:id/history', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id=?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json({ history: orderTimeline(order.id), payments: paymentTimeline(order.id) });
});
app.post('/api/admin/orders/:id/payment', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const status = ['pending','partial','paid','failed','refunded'].includes(req.body?.status) ? req.body.status : order.payment_status;
  const dueDate = req.body?.dueDate === undefined ? order.payment_due_date : String(req.body.dueDate || '').trim();
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: 'Data de vencimento inválida.' });
  const before = { status: order.payment_status, dueDate: order.payment_due_date, paidAt: order.payment_paid_at };
  db.transaction(() => {
    db.prepare('UPDATE orders SET payment_status=?, payment_due_date=?, payment_paid_at=CASE WHEN ?=\'paid\' THEN COALESCE(payment_paid_at,CURRENT_TIMESTAMP) ELSE payment_paid_at END, payment_reminder_sent_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, dueDate || null, status, id);
    db.prepare('INSERT OR IGNORE INTO order_payments (order_id, amount_cents, method, status, due_date) VALUES (?, ?, ?, ?, ?)').run(id, order.total_cents, order.payment_method, status, dueDate || null);
    db.prepare('UPDATE order_payments SET status=?, due_date=?, paid_at=CASE WHEN ?=\'paid\' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE paid_at END, failed_at=CASE WHEN ?=\'failed\' THEN COALESCE(failed_at,CURRENT_TIMESTAMP) ELSE NULL END, refunded_at=CASE WHEN ?=\'refunded\' THEN COALESCE(refunded_at,CURRENT_TIMESTAMP) ELSE NULL END, updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status NOT IN (\'refunded\')').run(status, dueDate || null, status, status, status, id);
  })();
  recordOrderHistory(id, 'payment_updated', before, { status, dueDate }, { type:'admin', id:req.admin?.sub, name:req.admin?.email }, String(req.body?.notes || ''));
  if (status === 'paid' && order.payment_status !== 'paid') queueNotification(order.customer_phone, 'payment_paid', { orderNumber: order.order_number, total: money(order.total_cents) }, `order:${id}:payment:paid`);
  if (status === 'failed' && order.payment_status !== 'failed') queueNotification(order.customer_phone, 'payment_failed', { orderNumber: order.order_number, total: money(order.total_cents) }, `order:${id}:payment:failed`);
  if (status === 'refunded' && order.payment_status !== 'refunded') queueNotification(order.customer_phone, 'payment_refunded', { orderNumber: order.order_number, total: money(order.total_cents) }, `order:${id}:payment:refunded`);
  if (status !== 'paid') queueNotification(order.customer_phone, 'payment_due', { orderNumber: order.order_number, total: money(order.total_cents), dueDate: dueDate || null }, `order:${id}:payment:${status}:${dueDate || 'none'}`);
  res.json({ order: orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(id)) });
});
app.post('/api/admin/orders/:id/operational-event', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const event = String(req.body?.event || '').trim();
  const allowed = {
    ready: ['order_ready', 'pedido pronto'],
    delayed: ['order_delayed', 'pedido atrasado'],
    picking_issue: ['picking_issue', 'problema na separação'],
    delivery_nearby: ['delivery_nearby', 'entrega próxima'],
    delivery_incident: ['delivery_incident', 'incidente na entrega']
  };
  if (!allowed[event]) return res.status(400).json({ error: 'Evento operacional inválido.' });
  const [type, label] = allowed[event];
  const reason = String(req.body?.reason || label);
  const key = `order:${id}:operational:${event}:${String(req.body?.key || reason).slice(0,80)}`;
  queueNotification(order.customer_phone, type, { orderNumber: order.order_number, reason }, key);
  recordOrderHistory(id, `operational_${event}`, { status: order.status, deliveryStatus: order.delivery_status, pickingStatus: order.picking_status }, { event, reason }, { type: 'admin', id: req.admin?.sub, name: req.admin?.email }, reason);
  logAudit('admin', req.admin?.sub, req.admin?.email, `operational_${event}`, 'order', id, { reason });
  res.json({ ok: true, event, notificationKey: key });
});

app.patch('/api/admin/orders/:id/payment-adjustments/:adjustmentId', requireAdmin, (req, res) => {
  const orderId = Number(req.params.id), adjustmentId = Number(req.params.adjustmentId);
  const adjustment = db.prepare('SELECT * FROM order_payment_adjustments WHERE id=? AND order_id=?').get(adjustmentId, orderId);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!adjustment || !order) return res.status(404).json({ error: 'Ajuste financeiro não encontrado.' });
  const status = ['pending','paid','failed','refunded'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Status financeiro inválido.' });
  if (adjustment.kind === 'refund' && status === 'paid') return res.status(400).json({ error: 'Use refunded para liquidar um estorno.' });
  db.transaction(() => {
    db.prepare("UPDATE order_payment_adjustments SET status=?, paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE paid_at END, refunded_at=CASE WHEN ?='refunded' THEN COALESCE(refunded_at,CURRENT_TIMESTAMP) ELSE refunded_at END, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, status, status, adjustmentId);
    if (adjustment.kind === 'additional_payment' && status === 'paid') db.prepare("UPDATE orders SET payment_status='paid', payment_paid_at=COALESCE(payment_paid_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND NOT EXISTS (SELECT 1 FROM order_payment_adjustments WHERE order_id=? AND kind='additional_payment' AND status NOT IN ('paid'))").run(orderId, orderId);
  })();
  recordOrderHistory(orderId, 'payment_adjustment_updated', { adjustmentId, status: adjustment.status }, { adjustmentId, status, kind: adjustment.kind, amountCents: adjustment.amount_cents }, { type: 'admin', id: req.admin?.sub, name: req.admin?.email }, String(req.body?.reason || ''));
  const current = db.prepare('SELECT * FROM order_payment_adjustments WHERE id=?').get(adjustmentId);
  if (status === 'paid') queueNotification(order.customer_phone, 'payment_difference_paid', { orderNumber: order.order_number, amount: money(adjustment.amount_cents) }, `order:${orderId}:adjustment:${adjustmentId}:paid`);
  if (status === 'refunded') queueNotification(order.customer_phone, 'refund_completed', { orderNumber: order.order_number, amount: money(adjustment.amount_cents) }, `order:${orderId}:adjustment:${adjustmentId}:refunded`);
  res.json({ adjustment: { ...current, amount: money(current.amount_cents) }, order: orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(orderId)) });
});

app.get('/api/admin/expenses', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM expenses WHERE active = 1 ORDER BY expense_date DESC, id DESC LIMIT 500').all();
  res.json({ expenses: rows.map(row => ({ ...row, amount: money(row.amount_cents) })) });
});

app.post('/api/admin/expenses', requireAdmin, (req, res) => {
  const description = String(req.body.description || '').trim();
  const amountCents = Math.max(0, cents(req.body.amount));
  const expenseDate = String(req.body.expenseDate || new Date().toISOString().slice(0, 10));
  if (!description || amountCents <= 0) return res.status(400).json({ error: 'Informe descrição e valor da despesa.' });
  const campaignId = Number(req.body.campaignId || 0) || null;
  const result = db.prepare('INSERT INTO expenses (description, amount_cents, category, expense_date, campaign_id) VALUES (?, ?, ?, ?, ?)').run(
    description, amountCents, String(req.body.category || 'outros'), expenseDate, campaignId
  );
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  logAudit('admin',req.admin?.sub,req.admin?.email,'expense_created','expense',result.lastInsertRowid,{description,amountCents,expenseDate,category});
  res.status(201).json({ expense: { ...row, amount: money(row.amount_cents) } });
});

app.patch('/api/admin/expenses/:id', requireAdmin, (req,res)=>{
  const id=Number(req.params.id),c=db.prepare('SELECT * FROM expenses WHERE id=?').get(id);
  if(!c)return res.status(404).json({error:'Despesa não encontrada.'});
  const description=String(req.body.description??c.description).trim(), amountCents=req.body.amount===undefined?c.amount_cents:Math.max(0,cents(req.body.amount)), category=String(req.body.category??c.category), expenseDate=String(req.body.expenseDate??c.expense_date);
  if(!description||amountCents<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(expenseDate))return res.status(400).json({error:'Dados da despesa inválidos.'});
  db.prepare('UPDATE expenses SET description=?,amount_cents=?,category=?,expense_date=? WHERE id=?').run(description,amountCents,category,expenseDate,id);
  logAudit('admin',req.admin?.sub,req.admin?.email,'expense_updated','expense',id,{description,amountCents,expenseDate});
  const row=db.prepare('SELECT * FROM expenses WHERE id=?').get(id);res.json({expense:{...row,amount:money(row.amount_cents)}});
});

app.delete('/api/admin/expenses/:id', requireAdmin, (req, res) => {
  const result = db.prepare('UPDATE expenses SET active = 0 WHERE id = ? AND active = 1').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Despesa não encontrada.' });
  logAudit('admin',req.admin?.sub,req.admin?.email,'expense_archived','expense',Number(req.params.id),{});
  res.json({ ok: true });
});

function campaignView(row) {
  const campaignProducts = db.prepare('SELECT * FROM campaign_catalog_products WHERE campaign_id=? ORDER BY id').all(row.id).map(p=>campaignCatalogProductView(p,true));
  const orderStats = db.prepare("SELECT COUNT(*) orders, COALESCE(SUM(total_cents),0) total, COALESCE(SUM(paid_cents),0) paid FROM campaign_orders WHERE campaign_id=? AND status!='cancelled'").get(row.id);
  return {...row, campaignProducts, products: [], orderCount:Number(orderStats.orders||0), orderTotal:money(orderStats.total), orderPaid:money(orderStats.paid)};
}
function campaignReservedQty(productId, excludeOrderId = null) {
  const row = db.prepare(`SELECT COALESCE(SUM(i.quantity),0) qty FROM campaign_order_items i JOIN campaign_orders o ON o.id=i.campaign_order_id WHERE i.campaign_product_id=? AND o.status!='cancelled' ${excludeOrderId ? 'AND o.id!=?' : ''}`).get(...(excludeOrderId ? [productId, excludeOrderId] : [productId]));
  return Number(row?.qty || 0);
}
function campaignRemainingQty(product, excludeOrderId = null) {
  if (product.available_qty === null || product.available_qty === undefined) return null;
  return Math.max(0, Number(product.available_qty) - campaignReservedQty(product.id, excludeOrderId));
}
function campaignCatalogProductView(row, includePrivate=false, excludeOrderId=null) {
  if(!row)return null;
  const remaining=campaignRemainingQty(row,excludeOrderId);
  const out={id:row.id,campaignId:row.campaign_id,name:row.name,description:row.description,unit:row.unit,price:money(row.price_cents),priceCents:row.price_cents,minQty:Number(row.min_qty),availableQty:remaining,configuredAvailableQty:row.available_qty===null?null:Number(row.available_qty),availabilityStatus:row.availability_status,createdAt:row.created_at,updatedAt:row.updated_at};
  if(includePrivate){out.cost=money(row.cost_cents);out.costCents=row.cost_cents;out.reservedQty=campaignReservedQty(row.id);}
  return out;
}
function campaignPublicView(row){
  return {id:row.id,name:row.name,description:row.description,start_date:row.start_date,end_date:row.end_date,payment_due_date:row.payment_due_date,delivery_date:row.delivery_date,active:Boolean(row.active),products:db.prepare("SELECT * FROM campaign_catalog_products WHERE campaign_id=? AND availability_status!='unavailable' ORDER BY id").all(row.id).map(p=>campaignCatalogProductView(p,false))};
}
function campaignOrderView(order){
  if(!order)return null;
  const items=db.prepare('SELECT * FROM campaign_order_items WHERE campaign_order_id=? ORDER BY id').all(order.id).map(i=>({id:i.id,campaignProductId:i.campaign_product_id,name:i.name_snapshot,unit:i.unit,quantity:Number(i.quantity),unitPrice:money(i.unit_price_cents),unitPriceCents:i.unit_price_cents,lineTotal:money(Math.round(Number(i.quantity)*Number(i.unit_price_cents))),availabilityStatus:i.availability_status,availableQty:i.available_qty===null?null:Number(i.available_qty)}));
  const paid=Number(order.paid_cents||0), total=Number(order.total_cents||0);
  const available=items.filter(i=>i.availabilityStatus==='available').length;
  const partial=items.filter(i=>i.availabilityStatus==='partial').length;
  const availabilityStatus=items.length&&available===items.length?'available':(available||partial)?'partial':'waiting';
  const deliveryStatus=['waiting','in_delivery','delivered'].includes(order.delivery_status)?order.delivery_status:'waiting';
  return {...order,total:money(total),totalCents:total,paid:money(paid),paidCents:paid,remaining:money(Math.max(0,total-paid)),remainingCents:Math.max(0,total-paid),items,availabilityStatus,deliveryStatus,paymentStatus:order.payment_status,productionStarted:Boolean(order.production_started_at),paymentDate:order.payment_date||null,refundPendingCents:Number(order.refund_pending_cents||0),refundPending:money(Number(order.refund_pending_cents||0))};
}
function validateCampaignProductInput(item){
  const name=String(item.name||'').trim();
  const unit=String(item.unit||'un').trim()||'un';
  const priceCents=Math.max(0,cents(item.price));
  const costCents=Math.max(0,cents(item.cost));
  const minQty=Math.max(0,Number(String(item.minQty??0).replace(',','.')));
  const availableQty=item.availableQty===''||item.availableQty===null||item.availableQty===undefined?null:Math.max(0,Number(String(item.availableQty).replace(',','.')));
  const availabilityStatus=['waiting','available','partial','unavailable'].includes(item.availabilityStatus)?item.availabilityStatus:'waiting';
  if(!name||priceCents<=0||!Number.isFinite(minQty)||minQty<0||(availableQty!==null&&!Number.isFinite(availableQty)))throw new Error('Produto de campanha inválido.');
  return {name,description:String(item.description||'').trim(),unit,costCents,priceCents,minQty,availableQty,availabilityStatus};
}
function campaignOperations(campaignId){
  const campaign=db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId); if(!campaign)return null;
  const products=db.prepare(`SELECT p.*,COALESCE((SELECT SUM(i.quantity) FROM campaign_order_items i JOIN campaign_orders o ON o.id=i.campaign_order_id WHERE o.campaign_id=? AND o.status!='cancelled' AND i.campaign_product_id=p.id),0) sold_qty,COALESCE((SELECT SUM(i.quantity) FROM campaign_order_items i JOIN campaign_orders o ON o.id=i.campaign_order_id WHERE o.campaign_id=? AND o.status!='cancelled' AND i.campaign_product_id=p.id AND i.availability_status='available'),0) available_order_qty FROM campaign_catalog_products p WHERE p.campaign_id=? ORDER BY p.id`).all(campaignId,campaignId,campaignId);
  const revenue=Number(db.prepare("SELECT COALESCE(SUM(total_cents),0) v FROM campaign_orders WHERE campaign_id=? AND status!='cancelled'").get(campaignId).v||0);
  const paid=Number(db.prepare("SELECT COALESCE(SUM(paid_cents),0) v FROM campaign_orders WHERE campaign_id=? AND status!='cancelled'").get(campaignId).v||0);
  return {campaign,products:products.map(p=>({...campaignCatalogProductView(p,true),soldQty:Number(p.sold_qty),availableOrderQty:Number(p.available_order_qty)})),summary:{revenue:money(revenue),paid:money(paid),pending:money(Math.max(0,revenue-paid)),revenueCents:revenue,paidCents:paid}};
}

app.post('/api/admin/campaign-links',requireAdmin,(req,res)=>{
  const campaignId=Number(req.body?.campaignId),campaign=db.prepare('SELECT * FROM campaigns WHERE id=? AND active=1').get(campaignId);
  if(!campaign)return res.status(404).json({error:'Campanha não encontrada.'});
  const token=makeToken(),expiresAt=new Date(Date.now()+campaignLinkHours()*3600000).toISOString();
  db.prepare('INSERT INTO campaign_public_links(campaign_id,token_hash,expires_at) VALUES(?,?,?)').run(campaignId,hashToken(token),expiresAt);
  logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_link_created','campaign',campaignId,{expiresAt});
  res.status(201).json({url:`${publicBaseUrl(req)}/campanha/${token}`,expiresAt,singleUse:true,campaignId,campaignName:campaign.name});
});

app.post('/api/internal/campaign-links',requireWhatsAppInternal,(req,res)=>{
  const campaignId=Number(req.body?.campaignId); const campaign=db.prepare('SELECT * FROM campaigns WHERE id=? AND active=1').get(campaignId);
  if(!campaign)return res.status(404).json({error:'Campanha não encontrada.'});
  const token=makeToken(),expiresAt=new Date(Date.now()+campaignLinkHours()*3600000).toISOString();
  db.prepare('INSERT INTO campaign_public_links(campaign_id,token_hash,expires_at) VALUES(?,?,?)').run(campaignId,hashToken(token),expiresAt);
  res.status(201).json({url:`${publicBaseUrl(req)}/campanha/${token}`,expiresAt,singleUse:true,campaignId,campaignName:campaign.name});
});

app.get('/api/public/campaign-access',requireCampaignAccess,(req,res)=>{
  const raw=campaignAccessFromRequest(req); const row=db.prepare('SELECT campaign_id FROM campaign_public_links WHERE token_hash=? AND used_at IS NOT NULL AND expires_at>datetime(\'now\')').get(hashToken(raw));
  const campaign=row&&db.prepare('SELECT * FROM campaigns WHERE id=? AND active=1').get(row.campaign_id); if(!campaign)return res.status(404).json({error:'Campanha não encontrada.'});
  res.json({campaign:campaignPublicView(campaign)});
});

app.get('/api/public/campaigns/:id',requireCampaignAccess,(req,res)=>{
  const campaign=db.prepare('SELECT * FROM campaigns WHERE id=? AND active=1').get(Number(req.params.id)); if(!campaign)return res.status(404).json({error:'Campanha não encontrada.'});
  const raw=campaignAccessFromRequest(req); const link=db.prepare('SELECT campaign_id FROM campaign_public_links WHERE token_hash=? AND used_at IS NOT NULL AND expires_at>datetime(\'now\')').get(hashToken(raw));
  if(!link||Number(link.campaign_id)!==campaign.id)return res.status(403).json({error:'Este link não pertence a esta campanha.'});
  res.json({campaign:campaignPublicView(campaign)});
});

function normalizeCampaignItems(campaignId,items,excludeOrderId=null,allowExistingUnavailable=false){
  if(!Array.isArray(items)||!items.length)throw new Error('O pedido precisa ter pelo menos um produto.');
  const normalized=[]; const seen=new Set();
  for(const raw of items){
    const product=db.prepare('SELECT * FROM campaign_catalog_products WHERE id=? AND campaign_id=?').get(Number(raw.campaignProductId),campaignId);
    const quantity=Number(raw.quantity);
    if(!product||!Number.isFinite(quantity)||quantity<=0)throw new Error('Produto ou quantidade inválida.');
    if(seen.has(product.id))throw new Error(`${product.name}: produto repetido.`); seen.add(product.id);
    const existingUnavailable=allowExistingUnavailable&&product.availability_status==='unavailable';
    if(product.availability_status==='unavailable'&&!existingUnavailable)throw new Error(`${product.name}: produto indisponível.`);
    if(Number(product.min_qty)>0&&quantity<Number(product.min_qty)&&!existingUnavailable)throw new Error(`${product.name}: quantidade mínima é ${product.min_qty} ${product.unit}.`);
    const remaining=campaignRemainingQty(product,excludeOrderId);
    if(remaining!==null&&quantity>remaining)throw new Error(`Quantidade insuficiente de ${product.name}. Disponível para novos pedidos: ${remaining} ${product.unit}.`);
    normalized.push({product,quantity,remaining,existingUnavailable});
  }
  return normalized;
}
function assertCampaignCapacity(normalized,excludeOrderId=null){
  for(const x of normalized){
    const stmt=db.prepare(`UPDATE campaign_catalog_products SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND (available_qty IS NULL OR available_qty - COALESCE((SELECT SUM(i.quantity) FROM campaign_order_items i JOIN campaign_orders o ON o.id=i.campaign_order_id WHERE i.campaign_product_id=campaign_catalog_products.id AND o.status!='cancelled' ${excludeOrderId?'AND o.id!=?':''}),0) >= ?)`);
    const args=excludeOrderId?[x.product.id,excludeOrderId,x.quantity]:[x.product.id,x.quantity];
    if(!stmt.run(...args).changes)throw new Error(`Quantidade insuficiente de ${x.product.name}.`);
  }
}
function snapshotPriceForOrderItem(orderId, productId, fallbackCents) {
  const row=db.prepare('SELECT unit_price_cents FROM campaign_order_items WHERE campaign_order_id=? AND campaign_product_id=? ORDER BY id DESC LIMIT 1').get(orderId,productId);
  return row ? Number(row.unit_price_cents) : Number(fallbackCents);
}
app.post('/api/public/campaigns/:id/orders',requireCampaignAccess,(req,res)=>{
  try{
    const campaignId=Number(req.params.id),campaign=db.prepare('SELECT * FROM campaigns WHERE id=? AND active=1').get(campaignId),body=req.body||{},customer=body.customer||{}; const today=new Date().toISOString().slice(0,10);
    if(!campaign)return res.status(404).json({error:'Campanha não encontrada.'});
    if(today<campaign.start_date||today>campaign.end_date)return res.status(409).json({error:'Esta campanha não está aberta para novos pedidos.'});
    if(!String(customer.name||'').trim()||normalizePhone(customer.phone).length<8)return res.status(400).json({error:'Informe nome e telefone válidos.'});
    const rawAccess=campaignAccessFromRequest(req);
    let createdId;
    db.transaction(()=>{
      const normalized=normalizeCampaignItems(campaignId,body.items);
      assertCampaignCapacity(normalized);
      const total=normalized.reduce((s,x)=>s+Math.round(x.quantity*x.product.price_cents),0);
      const orderNumber=nextCampaignOrderNumber(),accessCode=makeOrderAccessCode();
      const r=db.prepare('INSERT INTO campaign_orders(campaign_id,order_number,access_code,customer_name,customer_phone,customer_email,customer_number,customer_address,notes,total_cents) VALUES(?,?,?,?,?,?,?,?,?,?)').run(campaignId,orderNumber,accessCode,String(customer.name).trim(),normalizePhone(customer.phone),String(customer.email||'').trim(),String(customer.number||'').trim(),String(customer.address||'').trim(),String(body.notes||'').trim(),total);
      const ins=db.prepare('INSERT INTO campaign_order_items(campaign_order_id,campaign_product_id,name_snapshot,unit,quantity,unit_price_cents,unit_cost_cents,availability_status,available_qty) VALUES(?,?,?,?,?,?,?,?,?)');
      normalized.forEach(x=>ins.run(r.lastInsertRowid,x.product.id,x.product.name,x.product.unit,x.quantity,x.product.price_cents,x.product.cost_cents,'waiting',null));
      db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(r.lastInsertRowid,'created','{}',JSON.stringify({total,items:normalized.map(x=>({productId:x.product.id,quantity:x.quantity}))}),'customer',String(customer.name).trim());
      createdId=r.lastInsertRowid;
    })();
    const createdOrder=campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(createdId));
    const campaignUrl=rawAccess?`${publicBaseUrl(req)}/campanha/${rawAccess}`:'';
    queueNotification(createdOrder.customer_phone,'campaign_order_created',{orderNumber:createdOrder.order_number,accessCode:createdOrder.access_code,totalCents:createdOrder.totalCents,campaignName:campaign.name,campaignUrl});
    res.status(201).json({order:createdOrder});
  }catch(e){res.status(e.message?.includes('Quantidade insuficiente')?409:400).json({error:e.message});}
});
app.get('/api/public/campaign-orders/:number',requireCampaignAccess,(req,res)=>{
  const number=String(req.params.number||'').trim().toUpperCase(),phone=normalizePhone(req.query.phone),code=String(req.query.code||'').trim().toUpperCase(); let order=phone?db.prepare('SELECT * FROM campaign_orders WHERE order_number=? AND customer_phone=?').get(number,phone):null; if(!order&&code)order=db.prepare('SELECT * FROM campaign_orders WHERE order_number=? AND access_code=?').get(number,code); if(!order)return res.status(404).json({error:'Pedido da campanha não encontrado.'}); const campaign=db.prepare('SELECT * FROM campaigns WHERE id=?').get(order.campaign_id); const raw=campaignAccessFromRequest(req); const link=db.prepare('SELECT campaign_id FROM campaign_public_links WHERE token_hash=? AND used_at IS NOT NULL AND expires_at>datetime(\'now\')').get(hashToken(raw)); if(!link||Number(link.campaign_id)!==order.campaign_id)return res.status(403).json({error:'Este link não pertence a esta campanha.'}); res.json({campaign:campaignPublicView(campaign),order:campaignOrderView(order)});
});
app.patch('/api/public/campaign-orders/:number',requireCampaignAccess,(req,res)=>{
  try{
    const number=String(req.params.number||'').trim().toUpperCase(),phone=normalizePhone(req.body?.phone),code=String(req.body?.code||'').trim().toUpperCase(); const order=db.prepare('SELECT * FROM campaign_orders WHERE order_number=? AND access_code=? AND customer_phone=?').get(number,code,phone); if(!order)return res.status(404).json({error:'Pedido não encontrado.'});
    const campaign=db.prepare('SELECT * FROM campaigns WHERE id=?').get(order.campaign_id),today=new Date().toISOString().slice(0,10); if(!campaign||!campaign.active||today>campaign.end_date)return res.status(409).json({error:'O período para alterar este pedido já terminou.'}); if(order.status!=='open')return res.status(409).json({error:'Este pedido não pode mais ser alterado.'}); if(order.production_started_at)return res.status(409).json({error:'A produção deste pedido já começou. Solicite alteração ao administrador.'});
    const before=campaignOrderView(order);
    const oldPriceRows=db.prepare('SELECT campaign_product_id, unit_price_cents FROM campaign_order_items WHERE campaign_order_id=?').all(order.id);
    const oldPrices=new Map(oldPriceRows.map(x=>[Number(x.campaign_product_id),Number(x.unit_price_cents)]));
    db.transaction(()=>{
      const normalized=normalizeCampaignItems(order.campaign_id,req.body.items,order.id,true);
      assertCampaignCapacity(normalized,order.id);
      const total=normalized.reduce((sum,x)=>sum+Math.round(x.quantity*(oldPrices.get(x.product.id) ?? Number(x.product.price_cents))),0);
      const paid=Number(order.paid_cents||0);
      if(total<paid)throw new Error('O novo total fica abaixo do valor já pago. A redução exige aprovação do administrador.');
      db.prepare('DELETE FROM campaign_order_items WHERE campaign_order_id=?').run(order.id);
      const ins=db.prepare('INSERT INTO campaign_order_items(campaign_order_id,campaign_product_id,name_snapshot,unit,quantity,unit_price_cents,unit_cost_cents,availability_status,available_qty) VALUES(?,?,?,?,?,?,?,?,?)');
      normalized.forEach(x=>ins.run(order.id,x.product.id,x.product.name,x.product.unit,x.quantity,oldPrices.get(x.product.id) ?? Number(x.product.price_cents),x.product.cost_cents,'waiting',null));
      db.prepare('UPDATE campaign_orders SET total_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(total,order.id);
      db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(order.id,'customer_edit',JSON.stringify(before),JSON.stringify({total,paid}), 'customer',order.customer_name);
    })();
    const updated=campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(order.id));
    queueNotification(updated.customer_phone,'campaign_order_updated',{orderNumber:updated.order_number,totalCents:updated.totalCents,paidCents:updated.paidCents,remainingCents:updated.remainingCents,campaignName:campaign.name});
    res.json({order:updated});
  }catch(e){res.status(e.message?.includes('valor já pago')||e.message?.includes('Quantidade insuficiente')?409:400).json({error:e.message});}
});
app.get('/api/admin/campaign-orders',requireAdmin,(req,res)=>{const campaignId=Number(req.query.campaignId||0)||null; const rows=campaignId?db.prepare('SELECT * FROM campaign_orders WHERE campaign_id=? ORDER BY id DESC').all(campaignId):db.prepare('SELECT * FROM campaign_orders ORDER BY id DESC LIMIT 500').all(); res.json({orders:rows.map(campaignOrderView)});});
app.patch('/api/admin/campaign-orders/:id',requireAdmin,(req,res)=>{
  try{
    const id=Number(req.params.id),order=db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id);if(!order)return res.status(404).json({error:'Pedido da campanha não encontrado.'});
    const b=req.body||{}; let total=Number(order.total_cents), normalized=null, oldPrices=new Map();
    if(Array.isArray(b.items)){const oldPriceRows=db.prepare('SELECT campaign_product_id,unit_price_cents FROM campaign_order_items WHERE campaign_order_id=?').all(order.id);oldPrices=new Map(oldPriceRows.map(x=>[Number(x.campaign_product_id),Number(x.unit_price_cents)]));normalized=normalizeCampaignItems(order.campaign_id,b.items,order.id,true);total=normalized.reduce((s,x)=>s+Math.round(x.quantity*(oldPrices.get(x.product.id) ?? Number(x.product.price_cents))),0);}
    const paid=Number(order.paid_cents||0); if(total<paid&&!b.allowPaidReduction)return res.status(409).json({error:'O novo total fica abaixo do valor já pago. Confirme explicitamente o ajuste financeiro.'});
    db.transaction(()=>{
      if(normalized){
        assertCampaignCapacity(normalized,order.id);db.prepare('DELETE FROM campaign_order_items WHERE campaign_order_id=?').run(id);const ins=db.prepare('INSERT INTO campaign_order_items(campaign_order_id,campaign_product_id,name_snapshot,unit,quantity,unit_price_cents,unit_cost_cents,availability_status,available_qty) VALUES(?,?,?,?,?,?,?,?,?)');normalized.forEach(x=>ins.run(id,x.product.id,x.product.name,x.product.unit,x.quantity,(oldPrices.get(x.product.id) ?? Number(x.product.price_cents)),x.product.cost_cents,'waiting',null));}
      const nextPaid=paid; const refundPending=Math.max(0,paid-total); const nextStatus=nextPaid>=total?'paid':nextPaid>0?'partial':'pending';
      db.prepare('UPDATE campaign_orders SET customer_name=?,customer_phone=?,customer_email=?,customer_number=?,customer_address=?,notes=?,total_cents=?,paid_cents=?,payment_status=?,refund_pending_cents=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(b.customerName??order.customer_name).trim(),normalizePhone(b.customerPhone??order.customer_phone),String(b.customerEmail??order.customer_email),String(b.customerNumber??order.customer_number),String(b.customerAddress??order.customer_address),String(b.notes??order.notes),total,nextPaid,nextStatus,refundPending,['open','confirmed','cancelled'].includes(b.status)?b.status:order.status,id);
      db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(id,'admin_edit',JSON.stringify(campaignOrderView(order)),JSON.stringify({total,paid:nextPaid}), 'admin',req.admin?.email||'admin');
    })();
    const updated=campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id));
    logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_order_updated','campaign_order',id,{total,paid:updated.paidCents,refundPendingCents:updated.refundPendingCents});
    if(updated.refundPendingCents>0)queueNotification(updated.customer_phone,'campaign_refund_pending',{orderNumber:updated.order_number,refundPendingCents:updated.refundPendingCents});
    res.json({order:updated});
  }catch(e){res.status(e.message?.includes('Quantidade insuficiente')?409:400).json({error:e.message});}
});

app.patch('/api/admin/campaign-orders/:id/payment',requireAdmin,(req,res)=>{
  const id=Number(req.params.id),order=db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id);if(!order)return res.status(404).json({error:'Pedido da campanha não encontrado.'});
  const raw=req.body?.paidAmount===undefined?(req.body?.paid?Number(order.total_cents):0):req.body.paidAmount;
  const parsed=raw===''||raw===null||raw===undefined?0:cents(raw);
  if(!Number.isFinite(parsed)||parsed<0||parsed>Number(order.total_cents))return res.status(400).json({error:'O valor pago deve estar entre R$ 0,00 e o total do pedido.'});
  if(parsed<Number(order.paid_cents||0)&&!req.body?.allowPaymentReduction)return res.status(409).json({error:'A redução do valor já registrado exige confirmação explícita.'});
  const status=parsed>=Number(order.total_cents)?'paid':parsed>0?'partial':'pending';
  const paymentDate=parsed>0?String(req.body.paymentDate||new Date().toISOString().slice(0,10)):null; if(paymentDate&&!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))return res.status(400).json({error:'Data de pagamento inválida.'});
  db.prepare('UPDATE campaign_orders SET paid_cents=?,payment_status=?,payment_date=?,refund_pending_cents=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(parsed,status,paymentDate,id);
  db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(id,'payment_updated',JSON.stringify({paid:order.paid_cents,paymentStatus:order.payment_status,paymentDate:order.payment_date}),JSON.stringify({paid:parsed,paymentStatus:status,paymentDate}), 'admin',req.admin?.email||'admin');
  logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_payment_updated','campaign_order',id,{paid:parsed,status,paymentDate});
  if(status==='paid'&&order.payment_status!=='paid')queueNotification(order.customer_phone,'campaign_payment_paid',{orderNumber:order.order_number});
  res.json({order:campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id))});
});
app.patch('/api/admin/campaign-orders/:id/status',requireAdmin,(req,res)=>{const id=Number(req.params.id),order=db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id);if(!order)return res.status(404).json({error:'Pedido não encontrado.'});const allowed=['open','confirmed','cancelled'];const status=allowed.includes(req.body?.status)?req.body.status:order.status;if(status==='open'&&order.production_started_at&&!req.body.allowReopen)return res.status(409).json({error:'A produção já foi iniciada. Confirme explicitamente a reabertura excepcional.'});if(status==='cancelled'&&['shipped','delivered'].includes(order.status))return res.status(409).json({error:'Pedidos em entrega ou já entregues não podem ser cancelados.'});if(status==='cancelled'&&order.payment_status==='paid'&&req.body?.paymentStatus!=='refunded')return res.status(409).json({error:'Pedido pago: informe paymentStatus=refunded para cancelar.'});db.prepare("UPDATE campaign_orders SET status=?,payment_status=CASE WHEN ?='cancelled' AND ?='refunded' THEN 'refunded' ELSE payment_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,status,req.body?.paymentStatus,id);db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(id,'status_updated',JSON.stringify({status:order.status}),JSON.stringify({status}), 'admin',req.admin?.email||'admin');logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_order_status_updated','campaign_order',id,{from:order.status,to:status});if(status==='cancelled'&&order.status!=='cancelled')queueNotification(order.customer_phone,'campaign_order_cancelled',{orderNumber:order.order_number});res.json({order:campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id))});});
app.patch('/api/admin/campaign-orders/:id/production',requireAdmin,(req,res)=>{const id=Number(req.params.id),order=db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id);if(!order)return res.status(404).json({error:'Pedido não encontrado.'});const started=Boolean(req.body?.started);if(!started&&!req.body?.allowReopen)return res.status(409).json({error:'A produção não deve ser desfeita sem confirmação administrativa explícita.'});const at=started?(order.production_started_at||new Date().toISOString()):null;db.prepare('UPDATE campaign_orders SET production_started_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(at,id);db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(id,'production_updated',JSON.stringify({started:Boolean(order.production_started_at)}),JSON.stringify({started:Boolean(at)}), 'admin',req.admin?.email||'admin');logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_production_updated','campaign_order',id,{started:Boolean(at)});res.json({order:campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id))});});
app.patch('/api/admin/campaign-orders/:id/delivery',requireAdmin,(req,res)=>{const id=Number(req.params.id),order=db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id);if(!order)return res.status(404).json({error:'Pedido não encontrado.'});const status=['waiting','in_delivery','delivered'].includes(req.body?.deliveryStatus)?req.body.deliveryStatus:order.delivery_status;if(status==='delivered'&&order.status==='cancelled')return res.status(409).json({error:'Pedido cancelado não pode ser marcado como entregue.'});db.prepare('UPDATE campaign_orders SET delivery_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,id);db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(id,'delivery_updated',JSON.stringify({deliveryStatus:order.delivery_status}),JSON.stringify({deliveryStatus:status}),'admin',req.admin?.email||'admin');logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_delivery_updated','campaign_order',id,{from:order.delivery_status,to:status});if(status!==order.delivery_status)queueNotification(order.customer_phone,'campaign_delivery_updated',{orderNumber:order.order_number,deliveryStatus:status});res.json({order:campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(id))});});

app.patch('/api/admin/campaign-products/:id',requireAdmin,(req,res)=>{const id=Number(req.params.id),current=db.prepare('SELECT * FROM campaign_catalog_products WHERE id=?').get(id);if(!current)return res.status(404).json({error:'Produto da campanha não encontrado.'});try{const v=validateCampaignProductInput({...current,name:req.body.name??current.name,description:req.body.description??current.description,unit:req.body.unit??current.unit,cost:req.body.cost??money(current.cost_cents),price:req.body.price??money(current.price_cents),minQty:req.body.minQty??current.min_qty,availableQty:req.body.availableQty===undefined?current.available_qty:req.body.availableQty,availabilityStatus:req.body.availabilityStatus??current.availability_status});const reserved=campaignReservedQty(id);if(v.availableQty!==null&&v.availableQty<reserved)throw new Error(`A quantidade configurada não pode ser menor que o já reservado (${reserved}).`);db.prepare('UPDATE campaign_catalog_products SET name=?,description=?,unit=?,cost_cents=?,price_cents=?,min_qty=?,available_qty=?,availability_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(v.name,v.description,v.unit,v.costCents,v.priceCents,v.minQty,v.availableQty,v.availabilityStatus,id);logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_product_updated','campaign_catalog_product',id,{campaignId:current.campaign_id});res.json({product:campaignCatalogProductView(db.prepare('SELECT * FROM campaign_catalog_products WHERE id=?').get(id),true)});}catch(e){res.status(400).json({error:e.message});}});
app.delete('/api/admin/campaign-products/:id',requireAdmin,(req,res)=>{const id=Number(req.params.id),p=db.prepare('SELECT * FROM campaign_catalog_products WHERE id=?').get(id);if(!p)return res.status(404).json({error:'Produto da campanha não encontrado.'});const used=db.prepare('SELECT COUNT(*) c FROM campaign_order_items WHERE campaign_product_id=?').get(id);if(Number(used.c)>0)return res.status(409).json({error:'Este produto já faz parte de pedidos. Altere a disponibilidade em vez de excluir.'});db.prepare('DELETE FROM campaign_catalog_products WHERE id=?').run(id);logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_product_deleted','campaign_catalog_product',id,{campaignId:p.campaign_id});res.json({ok:true});});
app.patch('/api/admin/campaign-products/:id/availability',requireAdmin,(req,res)=>{const id=Number(req.params.id),p=db.prepare('SELECT * FROM campaign_catalog_products WHERE id=?').get(id);if(!p)return res.status(404).json({error:'Produto da campanha não encontrado.'});const status=['waiting','available','partial','unavailable'].includes(req.body?.availabilityStatus)?req.body.availabilityStatus:p.availability_status;const qty=req.body?.availableQty===undefined?p.available_qty:(req.body.availableQty===''||req.body.availableQty===null?null:Math.max(0,Number(req.body.availableQty)));if(qty!==null&&!Number.isFinite(qty))return res.status(400).json({error:'Quantidade disponível inválida.'});const reserved=campaignReservedQty(id);if(qty!==null&&qty<reserved)return res.status(409).json({error:`A quantidade configurada não pode ser menor que o já reservado (${reserved}).`});db.prepare('UPDATE campaign_catalog_products SET availability_status=?,available_qty=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,qty,id);logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_product_availability_updated','campaign_catalog_product',id,{status,availableQty:qty});res.json({product:campaignCatalogProductView(db.prepare('SELECT * FROM campaign_catalog_products WHERE id=?').get(id),true)});});
app.patch('/api/admin/campaign-order-items/:id/availability',requireAdmin,(req,res)=>{const id=Number(req.params.id),item=db.prepare('SELECT i.*,o.customer_phone,o.order_number,o.id order_id FROM campaign_order_items i JOIN campaign_orders o ON o.id=i.campaign_order_id WHERE i.id=?').get(id);if(!item)return res.status(404).json({error:'Item do pedido não encontrado.'});const status=['waiting','available','partial','unavailable'].includes(req.body?.availabilityStatus)?req.body.availabilityStatus:item.availability_status;const qty=req.body?.availableQty===undefined?item.available_qty:(req.body.availableQty===''||req.body.availableQty===null?null:Math.max(0,Number(req.body.availableQty)));if(qty!==null&&!Number.isFinite(qty))return res.status(400).json({error:'Quantidade disponível inválida.'});if(qty!==null&&qty>Number(item.quantity))return res.status(400).json({error:'A quantidade disponível não pode ser maior que a quantidade pedida.'});if(status==='partial'&&(qty===null||qty<=0||qty>=Number(item.quantity)))return res.status(400).json({error:'Para disponibilidade parcial, informe uma quantidade entre 1 e a quantidade pedida.'});if(status==='available'&&qty!==null&&qty<Number(item.quantity))return res.status(400).json({error:'Um item totalmente disponível deve ter toda a quantidade pedida disponível.'});if(status==='unavailable'&&qty!==null&&qty!==0)return res.status(400).json({error:'Item indisponível deve ter quantidade disponível igual a zero.'});if(qty!==null&&qty>Number(item.quantity))return res.status(400).json({error:'A quantidade disponível não pode superar a quantidade pedida.'});db.prepare('UPDATE campaign_order_items SET availability_status=?,available_qty=? WHERE id=?').run(status,qty,id);db.prepare('INSERT INTO campaign_order_history(campaign_order_id,action,before_json,after_json,actor_type,actor_name) VALUES(?,?,?,?,?,?)').run(item.order_id,'item_availability_updated',JSON.stringify({itemId:id,status:item.availability_status,availableQty:item.available_qty}),JSON.stringify({itemId:id,status,availableQty:qty}),'admin',req.admin?.email||'admin');logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_order_item_availability_updated','campaign_order_item',id,{orderId:item.order_id,status,availableQty:qty});if(status==='available'||status==='partial')queueNotification(item.customer_phone,'campaign_item_available',{orderNumber:item.order_number});res.json({order:campaignOrderView(db.prepare('SELECT * FROM campaign_orders WHERE id=?').get(item.order_id))});});
app.get('/api/admin/campaigns/:id/catalog',requireAdmin,(req,res)=>{const id=Number(req.params.id),campaign=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!campaign)return res.status(404).json({error:'Campanha não encontrada.'});res.json({products:db.prepare('SELECT * FROM campaign_catalog_products WHERE campaign_id=? ORDER BY id').all(id).map(p=>campaignCatalogProductView(p,true))});});
app.get('/api/admin/campaigns/:id/operations',requireAdmin,(req,res)=>{const data=campaignOperations(Number(req.params.id));if(!data)return res.status(404).json({error:'Campanha não encontrada.'});res.json(data);});
app.get('/api/admin/campaigns',requireAdmin,(_req,res)=>res.json({campaigns:db.prepare('SELECT * FROM campaigns ORDER BY start_date DESC,id DESC').all().map(campaignView)}));
app.post('/api/admin/campaigns',requireAdmin,(req,res)=>{try{const b=req.body||{},name=String(b.name||'').trim(),start=String(b.startDate||'').trim(),end=String(b.endDate||'').trim(),payment=String(b.paymentDueDate||'').trim(),delivery=String(b.deliveryDate||'').trim();if(!name||!/^(\d{4}-\d{2}-\d{2})$/.test(start)||!/^(\d{4}-\d{2}-\d{2})$/.test(end)||end<start)throw Error('Informe nome e datas válidas.');const id=db.transaction(()=>{const r=db.prepare('INSERT INTO campaigns(name,description,start_date,end_date,delivery_date,payment_due_date,active) VALUES(?,?,?,?,?,?,1)').run(name,String(b.description||'').trim(),start,end,delivery,payment);if(!Array.isArray(b.products)||!b.products.length)throw Error('Cadastre pelo menos um produto da campanha.');const ins=db.prepare('INSERT INTO campaign_catalog_products(campaign_id,name,description,unit,cost_cents,price_cents,min_qty,available_qty,availability_status) VALUES(?,?,?,?,?,?,?,?,?)');for(const item of b.products){const v=validateCampaignProductInput(item);ins.run(r.lastInsertRowid,v.name,v.description,v.unit,v.costCents,v.priceCents,v.minQty,v.availableQty,v.availabilityStatus);}return r.lastInsertRowid;})();res.status(201).json({campaign:campaignView(db.prepare('SELECT * FROM campaigns WHERE id=?').get(id))});}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/admin/campaigns/:id',requireAdmin,(req,res)=>{try{const id=Number(req.params.id),c=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!c)return res.status(404).json({error:'Campanha não encontrada.'});const b=req.body||{},name=String(b.name??c.name).trim(),start=String(b.startDate??c.start_date),end=String(b.endDate??c.end_date),payment=String(b.paymentDueDate ?? c.payment_due_date ?? '').trim(),delivery=String(b.deliveryDate ?? c.delivery_date ?? '').trim();if(!name||!/^(\d{4}-\d{2}-\d{2})$/.test(start)||!/^(\d{4}-\d{2}-\d{2})$/.test(end)||end<start)throw Error('Informe nome e datas válidas.');db.prepare('UPDATE campaigns SET name=?,description=?,start_date=?,end_date=?,delivery_date=?,payment_due_date=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,String(b.description??c.description).trim(),start,end,delivery,payment,b.active===undefined?c.active:(b.active?1:0),id);if(Array.isArray(b.products)){const ids=db.prepare('SELECT id FROM campaign_catalog_products WHERE campaign_id=?').all(id).map(x=>x.id);const keep=[];for(const item of b.products){const v=validateCampaignProductInput(item);if(item.id){const pid=Number(item.id);if(!ids.includes(pid))throw Error('Produto não pertence à campanha.');const reserved=campaignReservedQty(pid);if(v.availableQty!==null&&v.availableQty<reserved)throw Error(`A quantidade configurada não pode ser menor que o já reservado (${reserved}).`);db.prepare('UPDATE campaign_catalog_products SET name=?,description=?,unit=?,cost_cents=?,price_cents=?,min_qty=?,available_qty=?,availability_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(v.name,v.description,v.unit,v.costCents,v.priceCents,v.minQty,v.availableQty,v.availabilityStatus,pid);keep.push(pid);}else{const r=db.prepare('INSERT INTO campaign_catalog_products(campaign_id,name,description,unit,cost_cents,price_cents,min_qty,available_qty,availability_status) VALUES(?,?,?,?,?,?,?,?,?)').run(id,v.name,v.description,v.unit,v.costCents,v.priceCents,v.minQty,v.availableQty,v.availabilityStatus);keep.push(Number(r.lastInsertRowid));}}for(const pid of ids.filter(x=>!keep.includes(x))){const used=db.prepare('SELECT COUNT(*) c FROM campaign_order_items WHERE campaign_product_id=?').get(pid);if(Number(used.c)===0)db.prepare('DELETE FROM campaign_catalog_products WHERE id=?').run(pid);else db.prepare("UPDATE campaign_catalog_products SET availability_status='unavailable',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pid);}}logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_updated','campaign',id,{});res.json({campaign:campaignView(db.prepare('SELECT * FROM campaigns WHERE id=?').get(id))});}catch(e){res.status(400).json({error:e.message});}});
app.delete('/api/admin/campaigns/:id',requireAdmin,(req,res)=>{const id=Number(req.params.id),c=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!c)return res.status(404).json({error:'Campanha não encontrada.'});const orders=db.prepare("SELECT COUNT(*) c FROM campaign_orders WHERE campaign_id=? AND status!='cancelled'").get(id);if(Number(orders.c)>0)return res.status(409).json({error:'Esta campanha possui pedidos. Em vez de excluir, deixe-a inativa.'});db.prepare('UPDATE campaigns SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_archived','campaign',id,{});res.json({ok:true});});

app.get('/api/admin/suppliers', requireAdmin, (_req,res)=>res.json({suppliers:db.prepare('SELECT * FROM suppliers ORDER BY active DESC,name COLLATE NOCASE').all()}));
app.post('/api/admin/suppliers', requireAdmin, (req,res)=>{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Informe o nome do fornecedor.'});try{const r=db.prepare('INSERT INTO suppliers(name,phone,notes) VALUES(?,?,?)').run(name,normalizePhone(req.body.phone||''),String(req.body.notes||'').trim());logAudit('admin',req.admin?.sub,req.admin?.email,'supplier_created','supplier',r.lastInsertRowid,{name});res.status(201).json({supplier:db.prepare('SELECT * FROM suppliers WHERE id=?').get(r.lastInsertRowid)})}catch(e){res.status(409).json({error:'Fornecedor já cadastrado ou inválido.'})}});
app.patch('/api/admin/suppliers/:id', requireAdmin, (req,res)=>{const id=Number(req.params.id),c=db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);if(!c)return res.status(404).json({error:'Fornecedor não encontrado.'});db.prepare('UPDATE suppliers SET name=?,phone=?,notes=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(req.body.name??c.name).trim(),normalizePhone(req.body.phone??c.phone),String(req.body.notes??c.notes).trim(),req.body.active===undefined?c.active:(req.body.active?1:0),id);logAudit('admin',req.admin?.sub,req.admin?.email,'supplier_updated','supplier',id,{});res.json({supplier:db.prepare('SELECT * FROM suppliers WHERE id=?').get(id)})});
app.get('/api/admin/purchases', requireAdmin, (req,res)=>{const campaignId=Number(req.query.campaignId||0)||null;const rows=db.prepare(`SELECT pu.*,s.name supplier_name,s.phone supplier_phone,p.name product_name,c.name campaign_name FROM purchases pu JOIN suppliers s ON s.id=pu.supplier_id JOIN products p ON p.id=pu.product_id LEFT JOIN campaigns c ON c.id=pu.campaign_id ${campaignId?'WHERE pu.campaign_id=?':''} ORDER BY pu.purchase_date DESC,pu.id DESC LIMIT 500`).all(...(campaignId?[campaignId]:[]));res.json({purchases:rows.map(r=>({...r,unitCost:money(r.unit_cost_cents),totalCost:money(Number(r.quantity)*Number(r.unit_cost_cents))}))})});
app.post('/api/admin/purchases', requireAdmin, (req,res)=>{
  const supplierId=Number(req.body.supplierId),productId=Number(req.body.productId),campaignId=Number(req.body.campaignId||0)||null,quantity=Number(req.body.quantity),unitCost=Math.max(0,cents(req.body.unitCost)),date=String(req.body.purchaseDate||new Date().toISOString().slice(0,10)),status=['ordered','received','cancelled'].includes(req.body.status)?req.body.status:'ordered';
  if(!supplierId||!productId||!Number.isFinite(quantity)||quantity<=0||unitCost<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return res.status(400).json({error:'Informe fornecedor, produto, quantidade, custo e data válidos.'});
  try{const result=db.transaction(()=>{const applied=req.body.addToStock&&status!=='cancelled'?quantity:0;const r=db.prepare('INSERT INTO purchases(supplier_id,campaign_id,product_id,quantity,unit_cost_cents,purchase_date,status,notes,stock_applied_qty) VALUES(?,?,?,?,?,?,?,?,?)').run(supplierId,campaignId,productId,quantity,unitCost,date,status,String(req.body.notes||'').trim(),applied);if(applied){db.prepare('UPDATE products SET stock_qty=stock_qty+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(applied,productId);db.prepare("INSERT INTO stock_movements(product_id,type,quantity,unit_cost_cents,note,campaign_id) VALUES(?,?,?,?,?,?)").run(productId,'in',applied,unitCost,`Compra #${r.lastInsertRowid}`,campaignId);}logAudit('admin',req.admin?.sub,req.admin?.email,'purchase_created','purchase',r.lastInsertRowid,{supplierId,productId,campaignId,quantity,unitCost,stockApplied:applied});return r.lastInsertRowid;})();res.status(201).json({purchase:db.prepare('SELECT * FROM purchases WHERE id=?').get(result)});}catch(e){res.status(400).json({error:e.message});}
});
app.patch('/api/admin/purchases/:id', requireAdmin, (req,res)=>{
  const id=Number(req.params.id),c=db.prepare('SELECT * FROM purchases WHERE id=?').get(id);if(!c)return res.status(404).json({error:'Compra não encontrada.'});
  const b=req.body||{},supplierId=Number(b.supplierId??c.supplier_id),productId=Number(b.productId??c.product_id),campaignId=Number(b.campaignId||0)||null,quantity=b.quantity===undefined?Number(c.quantity):Number(b.quantity),unitCost=b.unitCost===undefined?Number(c.unit_cost_cents):Math.max(0,cents(b.unitCost)),date=String(b.purchaseDate??c.purchase_date),status=['ordered','received','cancelled'].includes(b.status)?b.status:c.status;
  if(!supplierId||!productId||!Number.isFinite(quantity)||quantity<=0||unitCost<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return res.status(400).json({error:'Dados da compra inválidos.'});
  try{db.transaction(()=>{const oldApplied=Number(c.stock_applied_qty||0);if(oldApplied){const oldProduct=db.prepare('SELECT stock_qty FROM products WHERE id=?').get(c.product_id);if(!oldProduct||Number(oldProduct.stock_qty)<oldApplied)throw new Error('Não é possível editar esta compra porque a quantidade já adicionada ao estoque foi consumida. Faça um ajuste de estoque.');db.prepare('UPDATE products SET stock_qty=stock_qty-?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(oldApplied,c.product_id);db.prepare("INSERT INTO stock_movements(product_id,type,quantity,unit_cost_cents,note,campaign_id) VALUES(?,?,?,?,?,?)").run(c.product_id,'out',oldApplied,c.unit_cost_cents,`Estorno da compra #${id}`,c.campaign_id);}
    const applied=(oldApplied>0||b.addToStock===true)&&status!=='cancelled'?quantity:0;
    db.prepare('UPDATE purchases SET supplier_id=?,campaign_id=?,product_id=?,quantity=?,unit_cost_cents=?,purchase_date=?,status=?,notes=?,stock_applied_qty=? WHERE id=?').run(supplierId,campaignId,productId,quantity,unitCost,date,status,String(b.notes??c.notes),applied,id);
    if(applied){db.prepare('UPDATE products SET stock_qty=stock_qty+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(applied,productId);db.prepare("INSERT INTO stock_movements(product_id,type,quantity,unit_cost_cents,note,campaign_id) VALUES(?,?,?,?,?,?)").run(productId,'in',applied,unitCost,`Aplicação da compra #${id}`,campaignId);}
    logAudit('admin',req.admin?.sub,req.admin?.email,'purchase_updated','purchase',id,{from:{productId:c.product_id,quantity:c.quantity,stockApplied:oldApplied},to:{productId,quantity,stockApplied:applied},status});
  })();res.json({purchase:db.prepare('SELECT * FROM purchases WHERE id=?').get(id)});}catch(e){res.status(409).json({error:e.message});}
});
app.patch('/api/admin/campaigns/:id/products/:productId/plan', requireAdmin, (req,res)=>{const campaignId=Number(req.params.id),productId=Number(req.params.productId),safety=Math.max(0,Number(req.body.safetyPct||0)),expected=Math.max(0,cents(req.body.expectedUnitCost)),supplierId=Number(req.body.supplierId||0)||null;db.prepare(`INSERT INTO campaign_product_plans(campaign_id,product_id,safety_pct,expected_unit_cost_cents,supplier_id,produced_qty,wasted_qty,notes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,product_id) DO UPDATE SET safety_pct=excluded.safety_pct,expected_unit_cost_cents=excluded.expected_unit_cost_cents,supplier_id=excluded.supplier_id,produced_qty=excluded.produced_qty,wasted_qty=excluded.wasted_qty,notes=excluded.notes`).run(campaignId,productId,safety,expected,supplierId,Math.max(0,Number(req.body.producedQty||0)),Math.max(0,Number(req.body.wastedQty||0)),String(req.body.notes||''));logAudit('admin',req.admin?.sub,req.admin?.email,'campaign_plan_updated','campaign_product',productId,{campaignId,safety,supplierId});res.json({ok:true})});
app.get('/api/admin/payables', requireAdmin, (req, res) => {
  const status = ['pending', 'paid', 'cancelled'].includes(req.query.status) ? req.query.status : 'all';
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const rows = status === 'all' ? db.prepare(`SELECT * FROM payables ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, due_date ASC, id DESC LIMIT 500`).all() : db.prepare(`SELECT * FROM payables ${where} ORDER BY due_date ASC, id DESC LIMIT 500`).all(status);
  const pending = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total FROM payables WHERE status = 'pending'").get();
  const overdue = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total FROM payables WHERE status = 'pending' AND due_date < date('now')").get();
  const next7 = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total FROM payables WHERE status = 'pending' AND due_date >= date('now') AND due_date <= date('now', '+7 day')").get();
  res.json({ payables: rows.map(payableView), summary: { pendingCount: Number(pending.count), pendingTotal: money(pending.total), overdueCount: Number(overdue.count), overdueTotal: money(overdue.total), next7Count: Number(next7.count), next7Total: money(next7.total) } });
});

app.post('/api/admin/payables', requireAdmin, (req, res) => {
  const body = req.body || {};
  const creditor = String(body.creditor || '').trim();
  const description = String(body.description || '').trim();
  const dueDate = String(body.dueDate || '').trim();
  const amountCents = Math.max(0, cents(body.amount));
  const recurrence = ['none', 'weekly', 'monthly', 'yearly'].includes(body.recurrence) ? body.recurrence : 'none';
  if (!creditor || !description || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || amountCents <= 0) return res.status(400).json({ error: 'Informe credor, descrição, valor e vencimento válido.' });
  const result = db.prepare('INSERT INTO payables (creditor, description, amount_cents, category, due_date, recurrence, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(creditor, description, amountCents, String(body.category || 'outros'), dueDate, recurrence, String(body.notes || '').trim());
  logAudit('admin',req.admin?.sub,req.admin?.email,'payable_created','payable',result.lastInsertRowid,{creditor,amountCents,dueDate});
  res.status(201).json({ payable: payableView(db.prepare('SELECT * FROM payables WHERE id = ?').get(result.lastInsertRowid)) });
});

app.patch('/api/admin/payables/:id', requireAdmin, (req, res) => {
  const id=Number(req.params.id),c=db.prepare('SELECT * FROM payables WHERE id=?').get(id); if(!c)return res.status(404).json({error:'Conta não encontrada.'});
  const b=req.body||{},status=['pending','paid','cancelled'].includes(b.status)?b.status:c.status,amount=b.amount===undefined?c.amount_cents:Math.max(0,cents(b.amount)),due=String(b.dueDate??c.due_date),paidDate=status==='paid'?String(b.paidDate||c.paid_date||new Date().toISOString().slice(0,10)):null;
  const creditor=String(b.creditor??c.creditor).trim(),description=String(b.description??c.description).trim(); if(!creditor||!description||amount<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(due))return res.status(400).json({error:'Dados da conta inválidos.'});
  db.prepare('UPDATE payables SET creditor=?,description=?,amount_cents=?,category=?,due_date=?,recurrence=?,status=?,paid_date=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(creditor,description,amount,String(b.category??c.category),due,['none','weekly','monthly','yearly'].includes(b.recurrence)?b.recurrence:c.recurrence,status,paidDate,String(b.notes??c.notes),id);
  logAudit('admin',req.admin?.sub,req.admin?.email,'payable_updated','payable',id,{status,amount}); res.json({payable:payableView(db.prepare('SELECT * FROM payables WHERE id=?').get(id))});
});

app.delete('/api/admin/payables/:id', requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE payables SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Conta não encontrada.' });
  logAudit('admin',req.admin?.sub,req.admin?.email,'payable_cancelled','payable',Number(req.params.id),{});
  res.json({ ok: true });
});

app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) AS revenue_cents,
           COUNT(*) AS order_count
    FROM orders WHERE status != 'cancelled'
  `).get();
  const received = db.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) AS received_cents
    FROM orders WHERE status != 'cancelled' AND payment_status = 'paid'
  `).get();
  const costs = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity * oi.unit_cost_cents), 0) AS cost_cents
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
  `).get();
  const expenses = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS expenses_cents FROM expenses WHERE active = 1').get();
  const pending = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'pending'").get();
  const lowStock = db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1 AND availability = 'ready' AND stock_qty <= low_stock_threshold").get();
  const supportOpen = db.prepare("SELECT COUNT(*) AS count FROM support_tickets WHERE status IN ('open','assigned')").get();
  const openOrders = db.prepare("SELECT * FROM orders WHERE status != 'cancelled' ORDER BY id DESC LIMIT 8").all();
  const revenueCents = Number(sales.revenue_cents);
  const costCents = Math.round(Number(costs.cost_cents));
  const expenseCents = Number(expenses.expenses_cents);
  const campaignStats=db.prepare("SELECT COALESCE(SUM(total_cents),0) revenue,COALESCE(SUM(paid_cents),0) received FROM campaign_orders WHERE status!='cancelled'").get();
  const campaignCost=db.prepare("SELECT COALESCE(SUM(i.quantity*i.unit_cost_cents),0) cost FROM campaign_order_items i JOIN campaign_orders o ON o.id=i.campaign_order_id WHERE o.status!='cancelled'").get();
  const campaignRevenueCents=Number(campaignStats.revenue||0),campaignReceivedCents=Number(campaignStats.received||0),campaignCostCents=Math.round(Number(campaignCost.cost||0));
  const totalRevenueCents=revenueCents+campaignRevenueCents,totalReceivedCents=Number(received.received_cents||0)+campaignReceivedCents,totalCostCents=costCents+campaignCostCents;
  res.json({
    revenue: money(totalRevenueCents),
    received: money(totalReceivedCents),
    cost: money(totalCostCents),
    expenses: money(expenseCents),
    profit: money(totalRevenueCents - totalCostCents - expenseCents),
    normalRevenue: money(revenueCents), campaignRevenue: money(campaignRevenueCents), campaignReceived: money(campaignReceivedCents), campaignCost: money(campaignCostCents),
    orderCount: Number(sales.order_count),
    pendingOrders: Number(pending.count),
    lowStock: Number(lowStock.count),
    supportOpen: Number(supportOpen.count),
    openOrders: openOrders.map(orderView)
  });
});

async function whatsappRequest(route, options = {}) {
  const response = await fetch(`${WA_INTERNAL_URL}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-wa-internal-token': WA_INTERNAL_TOKEN, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Serviço WhatsApp indisponível.');
  return data;
}

app.get('/api/admin/whatsapp/status', requireAdmin, async (_req, res) => {
  try {
    const data = await whatsappRequest('/internal/status');
    res.json(data);
  } catch (error) {
    res.json({ connected: false, status: 'offline', configuredNumber: process.env.STORE_WHATSAPP || '', qrDataUrl: null, note: error.message });
  }
});

app.post('/api/admin/whatsapp/reconnect', requireAdmin, async (_req, res) => {
  try { res.json(await whatsappRequest('/internal/reconnect', { method: 'POST' })); }
  catch (error) { res.status(503).json({ error: error.message }); }
});

app.post('/api/admin/whatsapp/logout', requireAdmin, async (_req, res) => {
  try { res.json(await whatsappRequest('/internal/logout', { method: 'POST' })); }
  catch (error) { res.status(503).json({ error: error.message }); }
});

app.get('/api/internal/notifications/pending', requireWhatsAppInternal, (_req, res) => {
  const rows = db.prepare("SELECT * FROM notifications WHERE sent_at IS NULL ORDER BY id ASC LIMIT 100").all();
  res.json({ notifications: rows.map(row => ({ id: row.id, phone: row.phone, type: row.type, payload: JSON.parse(row.payload_json || '{}') })) });
});
app.post('/api/internal/notifications/:id/sent', requireWhatsAppInternal, (req, res) => {
  db.prepare("UPDATE notifications SET sent_at = CURRENT_TIMESTAMP WHERE id = ? AND sent_at IS NULL").run(Number(req.params.id));
  res.json({ ok: true });
});
app.post('/api/internal/support/request', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.body?.phone); const name = String(req.body?.name || '').trim(); const orderNumber = String(req.body?.orderNumber || '').trim().toUpperCase();
  if (phone.length < 8) return res.status(400).json({ error: 'Número inválido.' });
  const existing = db.prepare("SELECT * FROM support_tickets WHERE customer_phone = ? AND status IN ('open','assigned') ORDER BY id DESC LIMIT 1").get(phone);
  let ticket = existing;
  if (!ticket) {
    const order = orderNumber ? db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber) : null;
    const result = db.prepare('INSERT INTO support_tickets (customer_name, customer_phone, order_id) VALUES (?, ?, ?)').run(name, phone, order?.id || null);
    ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.lastInsertRowid);
    logAudit('customer', null, name, 'support_opened', 'support_ticket', ticket.id, { phone, orderNumber });
  }
  queueStaffNotification('attend', 'new_support', { ticketId: ticket.id, customerName: ticket.customer_name, customerPhone: ticket.customer_phone, orderNumber });
  const attendants = db.prepare('SELECT id, name, phone FROM staff_users WHERE active = 1 AND can_attend = 1').all();
  res.status(201).json({ ticket: { id: ticket.id, status: ticket.status, assignedStaffId: ticket.assigned_staff_id }, attendants });
});
app.post('/api/internal/support/:id/message', requireWhatsAppInternal, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Mensagem vazia.' });
  const direction = ['inbound','outbound'].includes(req.body?.direction) ? req.body.direction : 'inbound';
  const senderType = String(req.body?.senderType || (direction === 'inbound' ? 'customer' : 'staff'));
  const row = db.prepare('INSERT INTO support_messages (ticket_id, direction, sender_type, sender_id, sender_name, message_type, body, delivery_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, direction, senderType, req.body?.senderId || null, String(req.body?.senderName || ''), String(req.body?.messageType || 'text'), body, String(req.body?.deliveryStatus || (direction === 'outbound' ? 'sent' : 'received')));
  db.prepare('UPDATE support_tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  res.status(201).json({ message: db.prepare('SELECT * FROM support_messages WHERE id=?').get(row.lastInsertRowid) });
});
app.get('/api/internal/support/:id/messages', requireWhatsAppInternal, (req, res) => {
  const rows = db.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id ASC LIMIT 500').all(Number(req.params.id));
  res.json({ messages: rows });
});
app.get('/api/internal/support/queue', requireWhatsAppInternal, (_req, res) => {
  const tickets = db.prepare("SELECT t.*, s.name AS staff_name FROM support_tickets t LEFT JOIN staff_users s ON s.id=t.assigned_staff_id WHERE t.status='open' ORDER BY t.created_at ASC LIMIT 100").all();
  res.json({ tickets });
});
app.get('/api/internal/support/by-phone', requireWhatsAppInternal, (req, res) => {
  const phone = normalizePhone(req.query.phone); const ticket = db.prepare("SELECT t.*, s.name AS staff_name, s.phone AS staff_phone FROM support_tickets t LEFT JOIN staff_users s ON s.id=t.assigned_staff_id WHERE t.customer_phone = ? AND t.status IN ('open','assigned') ORDER BY t.id DESC LIMIT 1").get(phone);
  res.json({ ticket: ticket || null });
});
app.post('/api/internal/support/:id/claim', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.body?.phone); const id = Number(req.params.id);
  if (!staff || !staff.can_attend) return res.status(403).json({ error: 'Sem permissão de atendimento.' });
  const ticket = db.prepare("SELECT * FROM support_tickets WHERE id = ? AND status IN ('open','assigned')").get(id);
  if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  if (ticket.assigned_staff_id && ticket.assigned_staff_id !== staff.id) return res.status(409).json({ error: 'Este atendimento já foi assumido por outro atendente.' });
  db.prepare("UPDATE support_tickets SET assigned_staff_id = ?, status='assigned', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(staff.id, id);
  logAudit('staff', staff.id, staff.name, 'support_claimed', 'support_ticket', id, {});
  queueNotification(ticket.customer_phone, 'support_assigned', { ticketId: id, staffName: staff.name });
  res.json({ ticket: db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) });
});
app.post('/api/internal/support/:id/close', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.body?.phone); const id = Number(req.params.id);
  if (!staff || !staff.can_attend) return res.status(403).json({ error: 'Sem permissão de atendimento.' });
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  if (ticket.assigned_staff_id !== staff.id) return res.status(403).json({ error: 'Este atendimento pertence a outro atendente.' });
  db.prepare("UPDATE support_tickets SET status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  queueNotification(ticket.customer_phone, 'support_closed', { ticketId: id });
  logAudit('staff', staff.id, staff.name, 'support_closed', 'support_ticket', id, {});
  res.json({ ok: true });
});
app.post('/api/internal/support/:id/message-target', requireWhatsAppInternal, (req, res) => {
  const staff = staffByPhone(req.body?.phone);
  if (!staff || !staff.can_attend) return res.status(403).json({ error: 'Sem permissão de atendimento.' });
  const ticket = db.prepare("SELECT t.*, s.phone AS staff_phone FROM support_tickets t LEFT JOIN staff_users s ON s.id=t.assigned_staff_id WHERE t.id=? AND t.status='assigned'").get(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Atendimento não está atribuído.' });
  if (ticket.assigned_staff_id !== staff.id) return res.status(403).json({ error: 'Este atendimento pertence a outro atendente.' });
  res.json({ phone: ticket.customer_phone, staffPhone: ticket.staff_phone });
});
app.get('/api/admin/support', requireAdmin, (_req, res) => {
  const tickets = db.prepare("SELECT t.*, s.name AS staff_name, o.order_number AS order_number FROM support_tickets t LEFT JOIN staff_users s ON s.id=t.assigned_staff_id LEFT JOIN orders o ON o.id=t.order_id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, t.id DESC LIMIT 300").all().map(ticket => ({ ...ticket, messages: db.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id ASC LIMIT 500').all(ticket.id) }));
  res.json({ tickets });
});
app.get('/api/admin/audit', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all().map(row => ({ ...row, details: JSON.parse(row.details_json || '{}') }));
  res.json({ logs: rows });
});
app.get('/api/admin/seller-results', requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT s.id, s.name, s.phone, COUNT(DISTINCT o.id) orders, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) salesCents, COALESCE(SUM(oi.quantity * oi.unit_vendor_price_cents),0) vendorCents, COALESCE(SUM(oi.quantity * (oi.unit_price_cents - oi.unit_vendor_price_cents)),0) sellerMarginCents, COALESCE(SUM(oi.quantity * (oi.unit_vendor_price_cents - oi.unit_cost_cents)),0) companyGrossCents FROM staff_users s LEFT JOIN orders o ON o.salesperson_id=s.id AND o.status!='cancelled' LEFT JOIN order_items oi ON oi.order_id=o.id GROUP BY s.id ORDER BY salesCents DESC`).all().map(r => ({ ...r, sales: money(r.salesCents), vendorValue: money(r.vendorCents), sellerMargin: money(r.sellerMarginCents), companyGross: money(r.companyGrossCents) }));
  res.json({ sellers: rows });
});

app.use('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/campanha/:token', (req,res)=>{ const token=String(req.params.token||''); const row=db.prepare("SELECT id,campaign_id FROM campaign_public_links WHERE token_hash=? AND used_at IS NULL AND expires_at>datetime('now')").get(hashToken(token)); if(!row)return res.status(410).send('Este link de campanha expirou ou já foi utilizado. Solicite um novo link.'); const campaign=db.prepare('SELECT id,active FROM campaigns WHERE id=?').get(row.campaign_id); if(!campaign||!campaign.active)return res.status(404).send('Esta campanha não está disponível.'); db.prepare('UPDATE campaign_public_links SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id); campaignAccessCookie(res,token); res.sendFile(path.join(PUBLIC_DIR,'campaign.html')); });
app.get('/catalogo/:token', (req, res) => {
  const token = String(req.params.token || '');
  const row = db.prepare("SELECT id FROM public_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')").get(hashToken(token));
  if (!row) return res.status(410).send('Este link de catálogo expirou ou já foi utilizado. Solicite um novo link.');
  db.prepare('UPDATE public_links SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  res.cookie('catalog_access', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: Math.round(catalogLinkHours() * 3600000), path: '/' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('*', (req, res) => {
  if (req.path === '/' || req.path === '/index.html') return res.status(403).send('Acesso ao catálogo não autorizado. Solicite um link válido.');
  return res.status(404).send('Página não encontrada.');
});


app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ error: `Falha no upload: ${error.message}` });
  res.status(400).json({ error: error.message || 'Erro interno.' });
});

function queuePaymentReminders() {
  if (String(process.env.PAYMENT_REMINDER_ENABLED || 'true').toLowerCase() !== 'true') return;
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dueLimit = tomorrow.toISOString().slice(0, 10);
  const rows = db.prepare("SELECT * FROM orders WHERE payment_status IN ('pending','partial') AND payment_due_date IS NOT NULL AND payment_due_date <= ? AND status NOT IN ('cancelled','delivered')").all(dueLimit);
  for (const order of rows) {
    const reminderKey = `order:${order.id}:payment-reminder:${dueLimit}`;
    const before = db.prepare('SELECT id FROM notifications WHERE idempotency_key=?').get(reminderKey);
    if (before) continue;
    queueNotification(order.customer_phone, 'payment_due', { orderNumber: order.order_number, total: money(order.total_cents), dueDate: order.payment_due_date }, reminderKey);
    db.prepare('UPDATE orders SET payment_reminder_sent_at=CURRENT_TIMESTAMP WHERE id=?').run(order.id);
  }
}
queuePaymentReminders();
setInterval(queuePaymentReminders, 15 * 60 * 1000).unref();

app.listen(PORT, HOST, () => {
  console.log(`Loja de doces disponível em http://${HOST}:${PORT}`);
});

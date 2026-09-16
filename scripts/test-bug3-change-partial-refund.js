const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const base = 'http://127.0.0.1:43174';
const testDir = path.join('/tmp', `doce-casa-bug3-${process.pid}-${Date.now()}`);
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: '43174',
  HOST: '127.0.0.1',
  DATA_DIR: testDir,
  JWT_SECRET: 'BUG3_TEST_JWT_SECRET_2026_12345678901234567890',
  WA_INTERNAL_TOKEN: 'BUG3_TEST_WA_TOKEN_2026_123456',
  ADMIN_EMAIL: 'bug3-test@doce-casa.local',
  ADMIN_PASSWORD: 'Bug3-Test-2026!9',
  WA_INTERNAL_URL: 'http://127.0.0.1:49999'
};

let child;
let serverOutput = '';
let cookie = '';

async function request(pathname, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {})
  };
  if (cookie) headers.cookie = cookie;

  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { status: response.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`${base}/`);
      if (response.status < 500) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor temporário não iniciou na porta 43174.');
}

async function login(db) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD
    })
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));

  const admin = db.prepare('SELECT id FROM admins WHERE email=?').get(env.ADMIN_EMAIL);
  assert.ok(admin, 'Admin de teste não foi criado.');

  const existingStaff = db.prepare('SELECT id FROM staff_users WHERE id=?').get(admin.id);
  if (!existingStaff) {
    db.prepare(`
      INSERT INTO staff_users
        (id, name, phone, active, can_sell, can_pick, can_deliver, can_view_financial, can_manage_products, can_attend)
      VALUES (?, 'Administrador BUG3', '5511888888888', 1, 1, 1, 1, 1, 1, 1)
    `).run(admin.id);
  }
}

function setupDatabase() {
  fs.mkdirSync(testDir, { recursive: true });

  const db = new Database(path.join(testDir, 'store.sqlite'));
  db.close();
}

function createScenario(db) {
  const product = db.prepare(`
    INSERT INTO products
      (name, slug, description, price_cents, vendor_price_cents,
       cost_cents, stock_qty, availability, active)
    VALUES
      ('Produto BUG3', 'produto-bug3', '', 1000, 700, 500, 100, 'ready', 1)
  `).run();

  const productId = Number(product.lastInsertRowid);

  const order = db.prepare(`
    INSERT INTO orders
      (order_number, customer_name, customer_phone, customer_email,
       payment_method, payment_status, status,
       subtotal_cents, shipping_cents, total_cents,
       inventory_committed, picking_status, delivery_status)
    VALUES
      (?, 'Cliente BUG3', '5511999999999', '',
       'pix', 'paid', 'pending',
       10000, 0, 10000,
       0, 'waiting', 'not_assigned')
  `).run(`BUG3-${Date.now()}`);

  const orderId = Number(order.lastInsertRowid);

  db.prepare(`
    INSERT INTO order_items
      (order_id, product_id, name_snapshot, quantity,
       unit_price_cents, unit_vendor_price_cents, unit_cost_cents)
    VALUES (?, ?, 'Produto BUG3', 10, 1000, 700, 500)
  `).run(orderId, productId);

  db.prepare(`
    INSERT INTO order_payments
      (order_id, amount_cents, method, status, paid_at, reference, notes)
    VALUES (?, 8000, 'pix', 'paid', CURRENT_TIMESTAMP,
            'test:bug3:paid80', 'Pagamento parcial BUG3')
  `).run(orderId);

  return { orderId, productId };
}

function createChangeRequest(db, orderId, productId) {
  const requested = {
    items: [{ productId, quantity: 5 }],
    shipping: { shippingCents: 0 },
    notes: 'Teste BUG3',
    requestedAt: new Date().toISOString()
  };

  const result = db.prepare(`
    INSERT INTO order_change_requests
      (order_id, access_code, customer_phone, requested_json, reason)
    VALUES (?, 'BUG3', '5511999999999', ?, 'Teste BUG3')
  `).run(orderId, JSON.stringify(requested));

  return Number(result.lastInsertRowid);
}

function readState(db, orderId) {
  return {
    payments: db.prepare(`
      SELECT id, amount_cents, status, method, reference
      FROM order_payments
      WHERE order_id=?
      ORDER BY id
    `).all(orderId),

    adjustments: db.prepare(`
      SELECT type, amount_cents, reason
      FROM order_payment_adjustments
      WHERE order_id=?
      ORDER BY id
    `).all(orderId),

    order: db.prepare(`
      SELECT total_cents, payment_status, payment_paid_at
      FROM orders
      WHERE id=?
    `).get(orderId)
  };
}

(async () => {
  try {
    setupDatabase();

    child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
    child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

    await waitForServer();

    const db = new Database(path.join(testDir, 'store.sqlite'));

    await login(db);

    try {
      const { orderId, productId } = createScenario(db);
      const changeRequestId = createChangeRequest(db, orderId, productId);

      const response = await request(`/api/admin/order-change-requests/${changeRequestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'approved' })
      });

      assert.equal(response.status, 200, JSON.stringify(response.data));

      const state = readState(db, orderId);

      assert.equal(state.order.total_cents, 5000);
      assert.equal(state.order.payment_status, 'paid');

      const paidRows = state.payments.filter(row => row.status === 'paid');
      const refundedRows = state.payments.filter(row => row.status === 'refunded');

      const paidCents = paidRows.reduce((sum, row) => sum + row.amount_cents, 0);
      const refundedCents = refundedRows.reduce((sum, row) => sum + row.amount_cents, 0);

      assert.equal(paidCents, 8000, 'Os R$80 pagos devem permanecer intactos.');
      assert.equal(refundedCents, 0, 'A aprovação não deve executar o reembolso automaticamente.');

      const refundAdjustment = state.adjustments.find(row => row.type === 'refund_pending');

      assert.ok(refundAdjustment, 'Deveria existir um ajuste refund_pending.');
      assert.equal(
        refundAdjustment.amount_cents,
        3000,
        'BUG3: o excesso correto é R$30, não R$50.'
      );

      const creditAdjustment = state.adjustments.find(row => row.type === 'credit');
      assert.equal(creditAdjustment, undefined, 'Não deve gerar credit quando existe excesso pago.');

      assert.equal(response.data.order.paymentStatus, 'paid');
      assert.equal(response.data.order.paidCents, 8000);
      assert.equal(response.data.order.remainingCents, 0);

      console.log('PASS BUG3: pedido R$100, pago R$80, alterado para R$50 => refund_pending R$30.');
      console.log('PASS: pagamento paid de R$80 preservado.');
      console.log('PASS: paymentStatus=paid e remainingCents=0.');
      console.log('PASS: nenhum credit indevido gerado.');
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(error.stack || error);
    if (serverOutput) console.error('--- saída do servidor temporário ---\n' + serverOutput);
    process.exitCode = 1;
  } finally {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  }
})();

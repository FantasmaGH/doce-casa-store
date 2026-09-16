const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:43174';
const dataDir = process.env.TEST_DATA_DIR;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const demonstrateBug = process.env.DEMONSTRATE_REFUND_BUG === '1';

if (!dataDir || !adminEmail || !adminPassword) {
  throw new Error('TEST_DATA_DIR, ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórios para este teste isolado.');
}

let cookie = '';
async function request(pathname, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {} };
}

async function login() {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
}

function createPaidOrder(db, suffix) {
  const result = db.prepare(`
    INSERT INTO orders
      (order_number, customer_name, customer_phone, payment_method, payment_status,
       subtotal_cents, total_cents, status)
    VALUES (?, 'Teste de estorno', '5511999999999', 'pix', 'paid', 10000, 10000, 'pending')
  `).run(`RF-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const orderId = Number(result.lastInsertRowid);
  db.prepare(`
    INSERT INTO order_payments
      (order_id, amount_cents, method, status, paid_at, reference, notes)
    VALUES (?, 10000, 'pix', 'paid', CURRENT_TIMESTAMP, ?, 'Pagamento original de teste')
  `).run(orderId, `test:refund:${suffix}`);
  return orderId;
}

function ledger(db, orderId) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END), 0) AS paidCents,
      COALESCE(SUM(CASE WHEN status='refunded' THEN amount_cents ELSE 0 END), 0) AS refundedCents,
      COUNT(CASE WHEN status='refunded' THEN 1 END) AS refundedRows
    FROM order_payments WHERE order_id=?
  `).get(orderId);
}

async function refund(orderId, amount, idempotencyKey) {
  return request(`/api/admin/orders/${orderId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason: 'Teste automatizado V6.5.2', idempotencyKey })
  });
}

(async () => {
  await login();
  const db = new Database(path.join(dataDir, 'store.sqlite'));
  try {
    const partialId = createPaidOrder(db, 'partial');
    const partialKey = `refund:${partialId}`;
    const first = await refund(partialId, '20,00', `${partialKey}:20`);
    assert.equal(first.status, 200, JSON.stringify(first.data));

    if (demonstrateBug) {
      const actual = ledger(db, partialId);
      assert.equal(actual.paidCents, 0, 'A reprodução esperava que o bug zerasse o valor pago.');
      assert.equal(actual.refundedCents, 10000, 'A reprodução esperava que o bug estornasse R$ 100,00.');
      console.log('BUG REPRODUZIDO: estorno solicitado R$20,00 marcou R$100,00 como refunded.');
      return;
    }

    let actual = ledger(db, partialId);
    assert.deepEqual(actual, { paidCents: 8000, refundedCents: 2000, refundedRows: 1 });
    assert.equal(first.data.order.paymentStatus, 'paid');
    assert.equal(first.data.order.paidCents, 8000);
    assert.equal(first.data.order.refundedPaymentCents, 2000);
    assert.equal(first.data.order.remainingCents, 0);
    assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(partialId).payment_status, 'paid');
    const firstHistory = db.prepare(`
      SELECT before_json, after_json FROM order_history
      WHERE order_id=? AND action='payment_refunded' ORDER BY id DESC LIMIT 1
    `).get(partialId);
    assert.deepEqual(JSON.parse(firstHistory.before_json), {
      paymentStatus: 'paid', paidCents: 10000, refundedCents: 0, remainingCents: 0
    });
    assert.deepEqual(JSON.parse(firstHistory.after_json), {
      paymentStatus: 'paid', paidCents: 8000, refundedCents: 2000, remainingCents: 0, amountCents: 2000
    });

    const replay = await refund(partialId, '20,00', `${partialKey}:20`);
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.idempotent, true);
    assert.deepEqual(ledger(db, partialId), actual);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_payment_adjustments WHERE order_id=? AND type='refund'").get(partialId).count, 1);

    const second = await refund(partialId, '30,00', `${partialKey}:30`);
    assert.equal(second.status, 200, JSON.stringify(second.data));
    actual = ledger(db, partialId);
    assert.deepEqual(actual, { paidCents: 5000, refundedCents: 5000, refundedRows: 2 });
    assert.equal(second.data.order.paymentStatus, 'paid');
    assert.equal(second.data.order.remainingCents, 0);

    const excessive = await refund(partialId, '50,01', `${partialKey}:excess`);
    assert.equal(excessive.status, 409, JSON.stringify(excessive.data));

    const finalPartial = await refund(partialId, '50,00', `${partialKey}:final`);
    assert.equal(finalPartial.status, 200, JSON.stringify(finalPartial.data));
    assert.deepEqual(ledger(db, partialId), { paidCents: 0, refundedCents: 10000, refundedRows: 3 });
    assert.equal(finalPartial.data.order.paymentStatus, 'refunded');
    assert.equal(finalPartial.data.order.remainingCents, 0);

    const fullId = createPaidOrder(db, 'full');
    const full = await refund(fullId, '100,00', `refund:${fullId}:full`);
    assert.equal(full.status, 200, JSON.stringify(full.data));
    assert.deepEqual(ledger(db, fullId), { paidCents: 0, refundedCents: 10000, refundedRows: 1 });
    assert.equal(full.data.order.paymentStatus, 'refunded');
    assert.equal(full.data.order.remainingCents, 0);

    const invalid = await refund(fullId, '-1,00', `refund:${fullId}:invalid`);
    assert.equal(invalid.status, 400, JSON.stringify(invalid.data));

    console.log('PASS estorno parcial/integral/múltiplo/idempotência/limite estornável');
  } finally {
    db.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

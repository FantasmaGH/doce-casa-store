const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:43173';
const adminEmail = process.env.TEST_ADMIN_EMAIL || 'admin@test.local';
const adminPassword = process.env.TEST_ADMIN_PASSWORD || 'testpass';
const internalToken = process.env.TEST_INTERNAL_TOKEN || '012345678901234567890123';
let cookie = '';
async function request(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  return { status: response.status, data, headers: response.headers };
}
async function expectStatus(path, expected, options = {}) {
  const r = await request(path, options);
  assert.equal(r.status, expected, `${path}: esperado ${expected}, recebido ${r.status}: ${JSON.stringify(r.data)}`);
  return r;
}
(async () => {
  await expectStatus('/api/health', 200);
  await expectStatus('/api/auth/login', 200, { method: 'POST', body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
  const adminCookie = cookie;

  let r = await expectStatus('/api/admin/products', 201, { method: 'POST', body: JSON.stringify({ name: 'Teste V65', description: 'produto de regressão', price: '30,00', vendorPrice: '7,00', cost: '4,50', stockQty: 100, availability: 'ready', priceTiers: [{ minQty: 1, maxQty: 1, price: 30, costCents: 450 }, { minQty: 2, maxQty: 10, price: 15, costCents: 450 }, { minQty: 11, maxQty: null, price: 10, costCents: 450 }] }) });
  const product = r.data.product;
  assert.equal(product.priceTiers[0].costCents, 450);
  r = await expectStatus('/api/admin/products', 200);
  const found = r.data.products.find(item => item.id === product.id);
  assert.equal(found.priceTiers[0].costCents, 450);
  console.log('PASS schema/login/product/price-tier-cost');

  const internal = { 'x-wa-internal-token': internalToken };
  r = await expectStatus('/api/internal/catalog-links', 201, { method: 'POST', headers: internal, body: JSON.stringify({ phone: '5511999999999' }) });
  const token = r.data.url.split('/').pop();
  const catalogCookie = cookie;
  assert.ok(token);
  r = await request(`/catalogo/${token}`, { headers: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const oneUseCookie = cookie;
  r = await request(`/catalogo/${token}`, { headers: { cookie: oneUseCookie } });
  assert.equal(r.status, 410);
  cookie = oneUseCookie;
  console.log('PASS single-use-catalog-link');

  r = await expectStatus('/api/public/orders', 201, { method: 'POST', body: JSON.stringify({ customer: { name: 'Cliente Teste', phone: '5511999999999', email: 'cliente@example.test' }, shipping: { postalCode: '01001000', address: 'Rua Teste, 1', city: 'São Paulo', state: 'SP', notes: 'portaria' }, paymentMethod: 'pix', items: [{ productId: product.id, quantity: 2 }], shippingCents: 1000 }) });
  const order = r.data.order;
  if (!order) { console.error('Resposta de criação de pedido:', JSON.stringify(r.data)); process.exit(1); }
  if (!order.orderNumber || !order.accessCode) { console.error('Campos do pedido:', JSON.stringify(order)); process.exit(1); }
  assert.equal(order.orderNumber, order.order_number);
  assert.equal(order.total, 40);
  console.log('PASS create-order/price/hidden-cost');

  cookie = '';
  r = await expectStatus(`/api/internal/order-status?number=${encodeURIComponent(order.orderNumber)}&code=${encodeURIComponent(order.accessCode)}&phone=5511999999999`, 200, { headers: internal });
  assert.equal(r.data.order.orderNumber, order.orderNumber);
  assert.ok(Array.isArray(r.data.order.timeline));
  assert.ok(r.data.order.timeline.length >= 1);
  console.log('PASS status/timeline');

  cookie = adminCookie;
  await expectStatus(`/api/admin/orders/${order.id}/payment`, 200, { method: 'POST', body: JSON.stringify({ status: 'pending', dueDate: '2099-12-31' }) });
  await expectStatus(`/api/admin/orders/${order.id}/payment`, 200, { method: 'POST', body: JSON.stringify({ status: 'paid', dueDate: '2099-12-31' }) });
  r = await expectStatus(`/api/admin/orders/${order.id}/history`, 200);
  assert.ok(r.data.payments.length >= 1);
  console.log('PASS payment/due-date/history');

  r = await expectStatus(`/api/public/orders/${encodeURIComponent(order.orderNumber)}/change-requests`, 201, { method: 'POST', body: JSON.stringify({ code: order.accessCode, phone: '5511999999999', reason: 'Atualizar observação', notes: 'Deixar com o porteiro' }) });
  assert.equal(r.data.status, 'pending');
  r = await expectStatus('/api/admin/order-change-requests', 200);
  assert.ok(r.data.requests.length >= 1);
  const change = r.data.requests.find(item => item.orderNumber === order.orderNumber || item.order_number === order.orderNumber);
  assert.ok(change?.id);
  r = await expectStatus(`/api/admin/order-change-requests/${change.id}`, 200, { method: 'PATCH', body: JSON.stringify({ decision: 'approved', paymentDueDate: '2099-12-31' }) });
  assert.equal(r.data.status, 'approved');
  r = await expectStatus(`/api/admin/orders/${order.id}`, 200);
  assert.equal(r.data.order.paymentStatus, 'paid');
  console.log('PASS change-request');

  r = await expectStatus(`/api/public/orders/${encodeURIComponent(order.orderNumber)}/change-requests`, 201, { method: 'POST', body: JSON.stringify({ code: order.accessCode, phone: '5511999999999', items: [{ productId: product.id, quantity: 3 }], reason: 'Aumentar quantidade' }) });
  const change2 = r.data.requestId;
  r = await expectStatus(`/api/admin/order-change-requests/${change2}`, 200, { method: 'PATCH', body: JSON.stringify({ decision: 'approved', paymentDueDate: '2099-12-31' }) });
  assert.equal(r.data.order.paymentStatus, 'partial');
  assert.ok(r.data.order.paymentAdjustments.some(item => item.kind === 'additional_payment' && item.amountCents === 1500));
  const adjustment = r.data.order.paymentAdjustments.find(item => item.kind === 'additional_payment');
  r = await expectStatus(`/api/admin/orders/${order.id}/payment-adjustments/${adjustment.id}`, 200, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) });
  assert.equal(r.data.adjustment.status, 'paid');
  console.log('PASS payment-difference-and-settlement');

  r = await expectStatus(`/api/admin/orders/${order.id}/operational-event`, 200, { method: 'POST', body: JSON.stringify({ event: 'delivery_nearby', reason: 'Chegando' }) });
  assert.equal(r.data.event, 'delivery_nearby');
  r = await expectStatus(`/api/admin/orders/${order.id}/payment`, 403, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ status: 'failed' }) });
  console.log('PASS operational-events-and-csrf-origin');

  console.log('PASS V6.5 regression suite');
})().catch(error => { console.error(error.stack || error); process.exit(1); });

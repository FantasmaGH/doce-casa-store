const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const whatsapp = fs.readFileSync(path.join(root, 'whatsapp-service.js'), 'utf8');

const required = [
  ['foreign keys', /foreign_keys\s*=\s*ON/i],
  ['order history', /CREATE TABLE IF NOT EXISTS order_history/i],
  ['change requests', /CREATE TABLE IF NOT EXISTS order_change_requests/i],
  ['payment history', /CREATE TABLE IF NOT EXISTS order_payments/i],
  ['payment adjustments', /CREATE TABLE IF NOT EXISTS order_payment_adjustments/i],
  ['persistent support messages', /CREATE TABLE IF NOT EXISTS support_messages/i],
  ['delivery attempts', /CREATE TABLE IF NOT EXISTS delivery_attempts/i],
  ['operational events', /CREATE TABLE IF NOT EXISTS order_operational_events/i],
  ['customer addresses', /CREATE TABLE IF NOT EXISTS customer_addresses/i],
  ['payment reminder idempotency', /CREATE TABLE IF NOT EXISTS payment_reminder_log/i],
  ['daily cash closures', /CREATE TABLE IF NOT EXISTS daily_cash_closures/i],
  ['DC sequential order', /return `DC-\$\{String\(next\)\.padStart\(6, '0'\)\}`/],
  ['same-day payment due', /payment_due_date/],
  ['admin approval', /\/api\/admin\/orders\/:id\/approve/],
  ['staff approval', /\/api\/internal\/staff\/orders\/:id\/approve/],
  ['refund endpoint', /\/api\/admin\/orders\/:id\/refund/],
  ['delivery attempt endpoint', /\/api\/admin\/orders\/:id\/delivery-attempt/],
  ['operational event endpoint', /\/api\/admin\/orders\/:id\/operational-event/],
  ['payment reminder queue', /function queuePaymentReminders/],
  ['security headers', /Content-Security-Policy/],
  ['catalog protection', /requireCatalogAccess/],
  ['internal token', /requireWhatsAppInternal/]
];

for (const [name, re] of required) assert.match(server, re, `Missing: ${name}`);

assert.match(whatsapp, /DC-\\d\{6\}/i, 'WhatsApp does not recognize DC-000123');
assert.match(whatsapp, /payment_reminder/, 'WhatsApp lacks payment reminder formatting');
assert.match(whatsapp, /order_confirmed/, 'WhatsApp lacks order confirmation formatting');
assert.match(whatsapp, /payment_refunded/, 'WhatsApp lacks refund formatting');
assert.match(whatsapp, /aprovar pedido/, 'WhatsApp lacks staff order approval command');

console.log(`PASS V6.5.2 complete static suite: ${required.length + 5} checks`);

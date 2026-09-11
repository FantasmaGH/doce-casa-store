const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[
 ['server.js','JWT secret has no insecure fallback',!read('server.js').includes("change-me-in-production")],
 ['server.js','internal token has no insecure fallback',!read('server.js').includes("change-wa-internal-token")],
 ['server.js','campaign reservation helper exists',read('server.js').includes('function assertCampaignCapacity')],
 ['server.js','campaign item availability is per order item',read('server.js').includes("/api/admin/campaign-order-items/:id/availability")&&!read('server.js').includes("UPDATE campaign_order_items SET availability_status=?,available_qty=? WHERE campaign_product_id")],
 ['server.js','campaign paid cents exposed',read('server.js').includes('paidCents:paid')],
 ['server.js','campaign refund pending supported',read('server.js').includes('refund_pending_cents')],
 ['server.js','campaign delivery has dedicated endpoint',read('server.js').includes("/api/admin/campaign-orders/:id/delivery")],
 ['server.js','normal inventory decrement is atomic',read('server.js').includes('stock_qty = stock_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock_qty >= ?')],
 ['server.js','normal cancellation restores committed stock',read('server.js').includes('Estorno do pedido ${current.order_number}')],
 ['server.js','purchase stock application tracked',read('server.js').includes('stock_applied_qty')],
 ['server.js','expenses soft archived',read('server.js').includes('UPDATE expenses SET active = 0')],
 ['server.js','support message target checks assigned staff',read('server.js').includes('Este atendimento pertence a outro atendente.')],
 ['campaign.js','campaign money uses cents',read('public/campaign.js').includes('moneyCents(p.priceCents)')],
 ['campaign.js','customer can copy order number',read('public/campaign.js').includes('copy-order-number')],
 ['campaign.js','customer can copy access code',read('public/campaign.js').includes('copy-order-code')],
 ['admin.js','campaign delivery action exists',read('public/admin.js').includes('data-campaign-delivery')],
 ['whatsapp-service.js','campaign created notification includes access code',read('whatsapp-service.js').includes('campaign_order_created')&&read('whatsapp-service.js').includes('Código de acesso')],
 ['whatsapp-service.js','WhatsApp internal token has no insecure fallback',!read('whatsapp-service.js').includes("change-wa-internal-token")],
];
let failed=0;
for(const [file,name,ok] of checks){console.log(`${ok?'OK':'FAIL'}  ${file}: ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`\nAudit V6.3 static: ${checks.length} checks OK.`);

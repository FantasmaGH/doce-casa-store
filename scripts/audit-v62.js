const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[
 ['server.js','JWT secret has no insecure fallback',!read('server.js').includes("change-me-in-production")],
 ['server.js','internal token has no insecure fallback',!read('server.js').includes("change-wa-internal-token")],
 ['server.js','campaign stock reservation helper exists',read('server.js').includes('function campaignReservedQty')],
 ['server.js','campaign item availability endpoint exists',read('server.js').includes("/api/admin/campaign-order-items/:id/availability")],
 ['server.js','campaign availability does not mass-update order items',!read('server.js').includes("UPDATE campaign_order_items SET availability_status=?,available_qty=? WHERE campaign_product_id=?")],
 ['server.js','campaign order view exposes paidCents',read('server.js').includes('paidCents:paid')],
 ['server.js','campaign order history is used',read('server.js').includes("campaign_order_history")],
 ['server.js','purchase stock application is tracked',read('server.js').includes('stock_applied_qty')],
 ['server.js','expenses are soft archived',read('server.js').includes('UPDATE expenses SET active = 0')],
 ['campaign.js','campaign money uses cents',read('public/campaign.js').includes('moneyCents(p.priceCents)')],
 ['admin.js','campaign item availability uses item id',read('public/admin.js').includes('data-campaign-item="${i.id}"')],
 ['whatsapp-service.js','campaign notification uses totalCents',read('whatsapp-service.js').includes('p.totalCents')],
];
let failed=0;for(const [file,name,ok] of checks){console.log(`${ok?'OK':'FAIL'}  ${file}: ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);console.log(`\nAudit V6.2: ${checks.length} checks OK.`);

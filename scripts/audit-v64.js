const fs = require('fs');
const cp = require('child_process');
const root = require('path').resolve(__dirname, '..');
const files = ['server.js','whatsapp-service.js','public/admin.js','public/campaign.js','public/store.js'];
const checks = [];
function ok(name, condition, detail='') { checks.push({name,ok:!!condition,detail}); }
for (const file of files) {
  const full=require('path').join(root,file); const r=cp.spawnSync(process.execPath,['--check',full],{encoding:'utf8'}); ok(`syntax ${file}`,r.status===0,r.stderr.trim());
}
const server=fs.readFileSync(require('path').join(root,'server.js'),'utf8');
const wa=fs.readFileSync(require('path').join(root,'whatsapp-service.js'),'utf8');
const admin=fs.readFileSync(require('path').join(root,'public/admin.js'),'utf8');
const html=fs.readFileSync(require('path').join(root,'public/admin.html'),'utf8');
const pkg=require(require('path').join(root,'package.json'));
ok('version 0.6.5.1',pkg.version==='0.6.5.1');
ok('customer table',server.includes('CREATE TABLE IF NOT EXISTS customers'));
ok('persistent registration sessions',server.includes('customer_registration_sessions'));
ok('approval permission',server.includes('can_approve_customers') && html.includes('canApproveCustomers'));
ok('WhatsApp ADM flag',server.includes('is_admin') && html.includes('isAdmin') && wa.includes('staff.isAdmin'));
ok('staff identity exposes new permissions',server.includes('canApproveCustomers: Boolean(staff.can_approve_customers)'));
ok('inbound LID resolution',wa.includes('resolveSenderPhone') && wa.includes('getContactLidAndPhone([from])'));
ok('outbound LID resolution',wa.includes('resolveWhatsAppId') && wa.includes('getContactLidAndPhone([numberId._serialized])'));
ok('unknown customer gate',wa.includes('ensureRegisteredCustomer') && wa.includes("/api/internal/customer-registration?phone="));
ok('3-step registration',wa.includes('preferred_name') && wa.includes('referrer_name') && wa.includes('referrer_phone'));
ok('pending blocks normal flow',wa.includes("status === 'pending'") && wa.includes('aguardando aprovação'));
ok('approval audit',server.includes("customer_${decision}") && server.includes('logAudit'));
ok('staff approval endpoint',server.includes('/api/internal/customer-registrations/decision'));
ok('admin approval endpoint',server.includes('/api/admin/customer-registrations/:id/decision'));
ok('admin customer UI',html.includes('section-customers') && admin.includes('loadCustomerRegistrations'));
ok('WhatsApp UI restored',admin.includes('loadWhatsapp') && admin.includes('startWhatsappPolling') && html.includes('section-whatsapp'));
ok('campaign v6.3 route retained',server.includes('/api/admin/campaign-order-items/:id/availability') && server.includes('/api/admin/campaign-orders/:id/delivery'));
ok('internal token protection',server.includes('requireWhatsAppInternal') && wa.includes('INTERNAL_TOKEN'));
const failed=checks.filter(x=>!x.ok);
for(const c of checks) console.log(`${c.ok?'OK':'FAIL'} ${c.name}${c.detail?` — ${c.detail}`:''}`);
console.log(`\n${checks.length-failed.length}/${checks.length} checks passed.`);
process.exitCode=failed.length?1:0;

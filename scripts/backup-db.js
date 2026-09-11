const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appDir = process.env.APP_DIR || '/opt/doce-casa-store';
const dataDir = process.env.DATA_DIR || path.join(appDir, 'data');
const backupDir = process.env.BACKUP_DIR || path.join(appDir, 'backups');
const source = path.join(dataDir, 'store.sqlite');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const destination = path.join(backupDir, `store-${stamp}.sqlite`);

fs.mkdirSync(backupDir, { recursive: true });
if (!fs.existsSync(source)) {
  console.log('Banco ainda não existe; nenhum arquivo SQLite foi copiado.');
  process.exit(0);
}
const db = new Database(source, { readonly: true });
db.backup(destination).then(() => {
  db.close();
  console.log(`Backup criado em ${destination}`);
}).catch(error => {
  db.close();
  console.error(error.message);
  process.exit(1);
});

# Implantação V4 — Doce Casa Store

## 1. Backup antes da troca

No servidor, faça um backup completo do diretório atual. Não apague `data/` nem `.env`.

Exemplo:

```bash
sudo cp -a /opt/doce-casa-store /opt/doce-casa-store-backup-$(date +%Y%m%d-%H%M%S)
```

## 2. Parar somente a loja durante a troca

Não use `pm2 delete all` nem `pm2 restart all`, pois outros bots podem estar rodando no mesmo servidor.

```bash
sudo pkill -TERM -u doceapp -f 'node server.js'
sudo pkill -TERM -u doceapp -f 'node whatsapp-service.js'
```

Confirme:

```bash
ps aux | grep -E 'node (server|whatsapp-service)\.js' | grep -v grep
```

## 3. Enviar o ZIP

Envie `doce-casa-store-v4-completo.zip` por SFTP para `/opt/doce-casa-store/`.

Extraia em pasta temporária:

```bash
rm -rf /opt/doce-casa-store-v4
mkdir /opt/doce-casa-store-v4
unzip -q /opt/doce-casa-store/doce-casa-store-v4-completo.zip -d /opt/doce-casa-store-v4
```

Copie o código sem apagar `.env` nem `data/`:

```bash
cp /opt/doce-casa-store-v4/server.js /opt/doce-casa-store/
cp /opt/doce-casa-store-v4/whatsapp-service.js /opt/doce-casa-store/
cp -a /opt/doce-casa-store-v4/public/. /opt/doce-casa-store/public/
cp /opt/doce-casa-store-v4/ecosystem.config.cjs /opt/doce-casa-store/
cp /opt/doce-casa-store-v4/package.json /opt/doce-casa-store/
cp /opt/doce-casa-store-v4/package-lock.json /opt/doce-casa-store/
cp /opt/doce-casa-store-v4/.env.example /opt/doce-casa-store/
cp -a /opt/doce-casa-store-v4/scripts/. /opt/doce-casa-store/scripts/
chown doceapp:doceapp /opt/doce-casa-store/server.js /opt/doce-casa-store/whatsapp-service.js
chown -R doceapp:doceapp /opt/doce-casa-store/public /opt/doce-casa-store/scripts
```

## 4. Dependências

Se `package-lock.json` foi alterado:

```bash
cd /opt/doce-casa-store
sudo -u doceapp npm ci --omit=dev
```

Se as dependências atuais já estiverem corretas, não é obrigatório reinstalar.

## 5. Validar sintaxe

```bash
node --check /opt/doce-casa-store/server.js
node --check /opt/doce-casa-store/whatsapp-service.js
node --check /opt/doce-casa-store/public/admin.js
node --check /opt/doce-casa-store/public/store.js
```

Todos devem voltar ao prompt sem erro.

## 6. Configuração

Preserve o `.env` atual. Garanta:

```env
REQUIRE_CATALOG_LINK=true
CATALOG_LINK_TTL_HOURS=0.5
WA_AUTO_REPLY_ENABLED=true
WA_SERVICE_HOST=127.0.0.1
WA_SERVICE_PORT=4174
STORE_API_URL=http://127.0.0.1:4173
WA_INTERNAL_URL=http://127.0.0.1:4174
```

Para uso profissional, prefira `PUBLIC_BASE_URL=https://seu-dominio` com HTTPS.

## 7. Primeiro teste manual

```bash
cd /opt/doce-casa-store
sudo -u doceapp node /opt/doce-casa-store/server.js
```

Em outro terminal:

```bash
curl -i http://127.0.0.1:4173/
```

Com catálogo protegido, deve retornar `403`.

Depois teste o WhatsApp em outro terminal:

```bash
cd /opt/doce-casa-store
sudo -u doceapp node /opt/doce-casa-store/whatsapp-service.js
```

A sessão existente em `data/whatsapp-auth` deve ser preservada. Se aparecer `authenticated` e `connected`, não escaneie QR novamente.

## 8. Testes mínimos V4

1. Raiz `/` = 403.
2. Link novo = abre catálogo.
3. Reabrir a mesma URL em outro navegador = 410.
4. Número desconhecido no WhatsApp = menu cliente.
5. Funcionário cadastrado = menu conforme permissões.
6. Vendedor envia `vender` = link de venda associado ao vendedor.
7. Pedido feito pelo link = `salesperson_id` correto.
8. Produto público não expõe custo.
9. Separador recebe fila e não pode assumir pedido já assumido por outro.
10. Separado alimenta fila de entrega.
11. Entregador recebe endereço e consegue marcar a caminho/entregue.
12. Cliente recebe somente status simples, especialmente `🚚 Saiu para entrega`.
13. `6` cria atendimento e notifica equipe autorizada.
14. Primeiro atendente que assume fica responsável.
15. Auditoria registra ações.
16. Alteração/cancelamento não apaga histórico.

## 9. PM2 depois de estabilizar

Somente depois dos testes:

```bash
sudo -iu doceapp
cd /opt/doce-casa-store
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
exit
```

Nunca execute `pm2 restart all` neste servidor se houver outros bots importantes.

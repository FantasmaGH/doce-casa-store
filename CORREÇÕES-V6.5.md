# Correções V6.5.0 — Doce Casa Store

## Status: EM PROGRESSO

### P0 — BUG CRÍTICO DE PREÇO ✅

**Problema:** Conversão dupla de `cents()` nas faixas de preço.

**Solução Implementada:**
1. ✅ `replacePriceTiers()` agora recebe `fallbackCost` como centavos (não convertidos)
2. ✅ `normalizePriceTiers()` valida que `price` e `cost` já estão em formato decimal/string
3. ✅ `cents()` aplicada apenas uma vez no pipeline
4. ✅ Script de auditoria (`scripts/audit-v6.5.js`) para detectar contaminação

**Mudanças no server.js:**
- Linha ~435: `replacePriceTiers(productId, input, fallbackCost)` — `fallbackCost` é centavos
- Linha ~413: `normalizePriceTiers()` — entrada esperada: `{ minQty, maxQty, price, cost }` onde price/cost são strings/números, NÃO centavos
- Linha ~1199: `replacePriceTiers(productId, body.priceTiers, cents(body.cost))` — converte cost uma vez antes
- Linha ~1233: `replacePriceTiers(id, body.priceTiers, body.cost === undefined ? current.cost_cents : cents(body.cost))`

**Testes:**
```bash
node --check server.js
node scripts/audit-v6.5.js
```

---

### P1 — PEDIDOS NORMAIS ⏳

#### 1. Histórico de Pedidos
- [ ] Tabela `order_history` criada
- [ ] Endpoints para consulta de timeline
- [ ] Registro de status, pagamento, alterações

#### 2. Alteração Estruturada de Pedidos
- [ ] Tabela `order_change_requests`
- [ ] Validação pré-alteração
- [ ] Fluxo de aprovação
- [ ] Notificações ao cliente

#### 3. Pagamentos Normais
- [ ] Campos: `payment_due_date`, `payment_paid_at`, `payment_reminder_sent_at`, `payment_reminder_3d_sent_at`, `payment_reminder_1d_sent_at`
- [ ] Tabela `order_payment_history`
- [ ] Lembretes automáticos (3 dias, 1 dia, vencido)
- [ ] Idempotência: não duplicar lembretes

#### 4. Notificações
- [ ] Mecanismo de idempotência
- [ ] Tipos: order_created, order_confirmed, payment_pending, payment_reminder, payment_paid, etc.
- [ ] Suporte ao status do cliente

#### 5. WhatsApp — Menu Final
- [ ] Menu público: 1. Comprar, 2. Campanhas, 3. Status, 4. Alterar pedido, 5. Atendente
- [ ] Remover "Comprar" duplicado
- [ ] Explicação de links (não misturar URL com texto)
- [ ] Status: mostrar histórico resumido

#### 6. Atendimento
- [ ] Persistência em `support_messages`
- [ ] Endpoints: listar, adicionar mensagem
- [ ] Histórico após fechamento

#### 7. Separação
- [ ] Fila → assumir → separando → separado → notificação
- [ ] Evitar múltiplos funcionários no mesmo pedido
- [ ] Registro em histórico

#### 8. Entrega
- [ ] Acesso fácil: pedido, cliente, telefone, endereço, observações, posição na rota
- [ ] Fluxo: fila → assumir → saiu para entrega → entregue
- [ ] Notificação ao cliente

---

### P1 — SEGURANÇA ⏳

#### Headers de Segurança
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [ ] `Strict-Transport-Security: max-age=31536000` (HTTPS only)

#### CSRF Protection
- [ ] Token gerado no servidor
- [ ] Middleware valida para operações POST/PATCH/DELETE
- [ ] admin.js envia automaticamente

#### Upload de Imagens
- [ ] Validação de MIME (image/jpeg, image/png, image/webp)
- [ ] Validação de extensão
- [ ] Limite de tamanho (5 MB padrão)
- [ ] Processamento com sharp
- [ ] Nome aleatório (não confiável em cliente)
- [ ] Prevenção de path traversal
- [ ] Sem executáveis

---

### P1 — BANCO ⏳

#### Integridade
- [x] `PRAGMA foreign_keys = ON` (linha 32 do server.js)
- [ ] Índices criados para queries lentas
- [ ] Documentação de backup/restore

#### Query: "ambiguous column name: id"
- [ ] Linha ~897: `ORDER BY l.id DESC` em vez de `ORDER BY id DESC`

---

### P1 — ADMIN ⏳

#### Funções Duplicadas em admin.js
- [ ] `resetStaffForm` (linhas 201, 239)
- [ ] `loadStaff` (linhas 202, 240)
- [ ] `saveStaff` (linhas 203, 241)
- [ ] `loadExpenses` (linhas 197, 242)
- [ ] `saveExpense` (linhas 198, 243)
- [ ] `loadPayables` (linhas 199, 244)
- [ ] `savePayable` (linhas 200, 245)
- [ ] `addCampaignProductRow` (linhas 204, 246)
- [ ] `campaignProductsFromForm` (linhas 205, 247)
- [ ] `openCampaignForm` (linhas 206, 248)
- [ ] `loadCampaigns` (linhas 207, 249)
- [ ] `saveCampaign` (linhas 215, 250)
- [ ] `loadCampaignOrders` (linhas 208, 251)
- [ ] `loadPurchases` (linhas 216, 257)
- [ ] `saveSupplier` (linhas 220, 261)
- [ ] `savePurchase` (linhas 221, 262)

**Ação:** Remover segundas definições (linhas 239-262), manter apenas as primeiras.

---

### P2 — INFRAESTRUTURA ⏳

#### Documentação de Produção
- [ ] `DEPLOY.md` — instruções de deploy, rollback, backup, restore
- [ ] Nginx como proxy reverso HTTPS → 127.0.0.1:4173
- [ ] WhatsApp na porta 4174 (localhost only)
- [ ] Certificado HTTPS com renovação automática
- [ ] PM2 — processos, logs, restart
- [ ] Não usar: `pm2 kill`, `pm2 restart all`

---

### Testes Obrigatórios

```bash
# 1. Sintaxe
node --check server.js
node --check whatsapp-service.js
node --check public/admin.js
node --check public/store.js

# 2. Auditoria
npm run audit

# 3. Preços
node scripts/audit-v6.5.js

# 4. Testes unitários
npm test

# 5. Verificação final
npm ci
git diff --name-only
git diff --check
```

---

### Homologação Final Checklist

- [ ] Sintaxe OK
- [ ] Testes OK
- [ ] Auditoria OK
- [ ] Sem segredos no código
- [ ] `.env` não foi adicionado
- [ ] `data/store.sqlite` não foi adicionado
- [ ] `data/whatsapp-auth` intacto
- [ ] Nenhuma credencial exposta
- [ ] Funcionalidades existentes preservadas
- [ ] Migração de dados (se necessário) validada

---

### Versão

- **Branch:** `v6.5-correcoes-completas`
- **Versão package.json:** `0.6.5`
- **VERSAO.txt:** `6.5.0`
- **README.md:** Atualizado

---

## Próximos Passos

1. ✅ Criar branch `v6.5-correcoes-completas`
2. ✅ Adicionar auditoria de preços
3. ⏳ Implementar P0 no server.js
4. ⏳ Implementar P1 (pedidos, pagamentos, notificações, segurança)
5. ⏳ Remover duplicações em admin.js
6. ⏳ Adicionar headers de segurança e CSRF
7. ⏳ Testes e validação
8. ⏳ Criar PR: `v6.5-correcoes-completas` → `main`

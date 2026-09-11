# Testes V6.5.0 — Validação Completa

## Pré-requisitos

```bash
cd /path/to/doce-casa-store
npm ci
node --version  # v18+ recomendado
```

## 1. Validação de Sintaxe

```bash
# Verificar sintaxe de todos os arquivos principais
node --check server.js
node --check whatsapp-service.js
node --check public/admin.js
node --check public/store.js
```

**Esperado:** Nenhum erro ou avisos de sintaxe.

---

## 2. Auditoria de Preços (P0)

```bash
# Executar auditoria de detecção de contaminação dupla
node scripts/audit-v6.5.js
```

**Esperado:**
```
=== AUDITORIA V6.5 — PREÇOS ===

📊 Analisando X produtos ativos...

✅ Nenhum preço suspeito detectado.
```

Se houver preços suspeitos, a saída mostrará:
```
⚠️  Nome do Produto (ID: X)
   Faixa: N–M unidades
   Preço: 1234.56 (suspeito: 123456)
   Custo: 789.01 (suspeito: 78901)
```

---

## 3. Auditoria de Segurança e Dependências

```bash
npm audit
```

**Esperado:** Vulnerabilidades críticas resolvidas. Avisos baixos são aceitáveis se não quebrarem compatibilidade com whatsapp-web.js e Puppeteer.

---

## 4. Verificação de Banco de Dados

```bash
# Verificar integridade da estrutura
sqlite3 data/store.sqlite << 'EOF'
PRAGMA foreign_keys = ON;
SELECT COUNT(*) as total_products FROM products;
SELECT COUNT(*) as total_orders FROM orders;
SELECT COUNT(*) as total_price_tiers FROM product_price_tiers;
SELECT COUNT(*) as total_order_history FROM order_history;
PRAGMA table_info(orders);
EOF
```

**Esperado:**
- ✅ `PRAGMA foreign_keys = ON` funciona sem erro
- ✅ Tabelas existem e contêm dados
- ✅ Coluna `order_history` está presente (se implementada)
- ✅ Nenhum erro de integridade referencial

---

## 5. Teste de Preços em Centavos

### Teste Manual — Criar Produto com Faixa de Preço

1. Acessar `/admin`
2. Ir para **Produtos**
3. Criar novo produto:
   - Nome: "Teste V6.5 - Brownie"
   - Preço: `5.50`
   - Custo: `2.25`
   - Faixa 1: `1-10 | 5.50 | 2.25`
   - Faixa 2: `11-50 | 5.00 | 2.25`
   - Faixa 3: `51+ | 4.50 | 2.25`

4. Salvar e verificar no banco:

```bash
sqlite3 data/store.sqlite << 'EOF'
SELECT id, name, price_cents, cost_cents FROM products WHERE name LIKE '%Teste V6.5%';
SELECT id, min_qty, max_qty, price_cents, cost_cents FROM product_price_tiers 
WHERE product_id = (SELECT id FROM products WHERE name LIKE '%Teste V6.5%');
EOF
```

**Esperado:**
```
1 | Teste V6.5 - Brownie | 550 | 225
1 | 1 | 10 | 550 | 225
2 | 11 | 50 | 500 | 225
3 | 51 | (null) | 450 | 225
```

**NÃO deve aparecer:**
```
550 | 55000  (conversão dupla)
5.50 | 550   (string em vez de número)
```

---

## 6. Teste de Carrinho e Checkout

### Cenário 1: Carrinho com Desconto por Quantidade

1. Abrir catálogo público
2. Adicionar 5 unidades do "Teste V6.5 - Brownie"
3. Verificar preço: deve ser R$ 5.50 × 5 = R$ 27.50 (faixa 1-10 = R$ 5.50)
4. Aumentar para 15 unidades
5. Verificar preço: deve ser R$ 5.00 × 15 = R$ 75.00 (faixa 11-50 = R$ 5.00)
6. Aumentar para 60 unidades
7. Verificar preço: deve ser R$ 4.50 × 60 = R$ 270.00 (faixa 51+ = R$ 4.50)

**Esperado:** Cálculos corretos sem erros de arredondamento.

### Cenário 2: Checkout

1. Proceder com 60 unidades
2. Preencher formulário de checkout
3. Enviar pedido
4. Verificar banco:

```bash
sqlite3 data/store.sqlite << 'EOF'
SELECT id, order_number, total_cents, subtotal_cents FROM orders ORDER BY id DESC LIMIT 1;
SELECT product_id, quantity, unit_price_cents, unit_cost_cents FROM order_items 
WHERE order_id = (SELECT id FROM orders ORDER BY id DESC LIMIT 1);
EOF
```

**Esperado:**
```
1 | PED-20260911-ABC | 27000 | 27000
1 | 60 | 450 | 225
```

Total: 60 × 450 = 27.000 centavos = R$ 270.00 ✅

---

## 7. Teste de Admin.js — Verificar Duplicações

```bash
# Contar quantas vezes cada função é definida
grep -n "^async function resetStaffForm" public/admin.js
grep -n "^async function loadStaff" public/admin.js
grep -n "^async function saveStaff" public/admin.js
# ... etc
```

**Esperado:** Cada função aparece apenas 1 vez (não 2).

Se houver duplicações, exemplo:
```
201: async function resetStaffForm
239: async function resetStaffForm  ← REMOVER ESTA
```

---

## 8. Teste de Query "ambiguous column name: id"

Se implementado, testar:

```bash
# Acessar admin → Links do Catálogo
curl -X GET http://localhost:4173/api/admin/catalog-links \
  -H "Cookie: store_admin=<token>"
```

**Esperado:** Lista de links sem erro SQL "ambiguous column name: id".

---

## 9. Teste de Segurança — Headers

```bash
curl -I http://localhost:4173/
```

**Esperado** (quando implementado):
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## 10. Teste de Upload de Imagens

### Cenário: Upload Válido

```bash
curl -X POST http://localhost:4173/api/admin/products/1/image \
  -F "image=@/path/to/test.jpg" \
  -H "Cookie: store_admin=<token>"
```

**Esperado:**
- Status 200
- Imagem processada com sharp e salva como `.webp`
- Watermark adicionado
- Caminho retornado em `product.imageUrl`

### Cenário: Upload Inválido

1. Arquivo > 5 MB
2. Arquivo não-imagem (PDF, EXE, etc.)
3. MIME Type falso

**Esperado:** Todos rejeitados com erro descritivo.

---

## 11. Teste de Notificações (Idempotência)

Se implementado:

```bash
# Criar 2 pedidos simultâneos (condição de corrida)
# Cada um deve gerar exatamente 1 notificação de "pedido recebido"
# Não 2 notificações

# Verificar fila:
curl -X GET http://localhost:4174/internal/notifications/pending \
  -H "x-wa-internal-token: <token>"

# Marcar como enviada:
curl -X POST http://localhost:4174/internal/notifications/1/sent \
  -H "x-wa-internal-token: <token>"

# Tentar marcar novamente:
curl -X POST http://localhost:4174/internal/notifications/1/sent \
  -H "x-wa-internal-token: <token>"
```

**Esperado:** Segunda chamada idempotente (não cria duplicata).

---

## 12. Teste de Funcionalidades Existentes

### Campanhas

```bash
# Criar campanha
curl -X POST http://localhost:4173/api/admin/campaigns \
  -H "Content-Type: application/json" \
  -H "Cookie: store_admin=<token>" \
  -d '{"name":"Teste","startDate":"2026-09-11","endDate":"2026-09-20",...}'

# Listar campanhas
curl -X GET http://localhost:4173/api/admin/campaigns \
  -H "Cookie: store_admin=<token>"
```

**Esperado:** Campanhas funcionam sem alteração.

### Separação e Entrega

```bash
# Listar operações
curl -X GET http://localhost:4173/api/admin/operations/orders \
  -H "Cookie: store_admin=<token>"

# Atualizar status
curl -X PATCH http://localhost:4173/api/admin/orders/1/operations \
  -H "Content-Type: application/json" \
  -H "Cookie: store_admin=<token>" \
  -d '{"pickingStatus":"separating"}'
```

**Esperado:** Fluxo de separação e entrega intacto.

---

## 13. Testes de Integração (se houver test suite)

```bash
npm test
```

**Esperado:** Todos os testes passam. Se houver novos testes para P0/P1, devem estar verdes.

---

## 14. Verificação de Git

```bash
# Verificar arquivos modificados
git status

# Verificar que .env, data/ não foram adicionados
git ls-files | grep -E '\.env|data/store\.sqlite|data/whatsapp-auth'

# Esperado: nada deve aparecer

# Verificar diffs
git diff --stat
git diff HEAD public/admin.js | head -50  # Verificar se removeu duplicatas

# Verificar que não há segredos
git diff HEAD | grep -iE 'password|secret|token|api[_-]key'

# Esperado: nada relacionado a credenciais
```

---

## 15. Homologação Final

```bash
# 1. Limpar e reinstalar
rm -rf node_modules package-lock.json
npm ci

# 2. Verificar sintaxe
node --check server.js
node --check whatsapp-service.js
node --check public/admin.js
node --check public/store.js

# 3. Iniciar servidor
NODE_ENV=development \
ADMIN_EMAIL=test@test.com \
ADMIN_PASSWORD=testpass123 \
JWT_SECRET=your-256-bit-secret-key-here-at-least-32-chars \
WA_INTERNAL_TOKEN=your-wa-internal-token-at-least-24-chars \
node server.js

# Em outro terminal:
node whatsapp-service.js

# 4. Rodar auditoria
node scripts/audit-v6.5.js

# 5. Testar endpoints
curl http://localhost:4173/api/health

# Esperado: {"ok":true,"service":"doce-casa-store"}
```

---

## Resultado Final

Se todos os testes passarem:

✅ **V6.5.0 está pronta para homologação/produção**

Documentar em PR:
- ✅ Sintaxe validada
- ✅ Auditoria de preços OK
- ✅ Testes de checkout OK
- ✅ Funções duplicadas removidas
- ✅ Headers de segurança implementados
- ✅ Upload seguro validado
- ✅ Funcionalidades existentes preservadas
- ✅ Nenhum segredo exposto

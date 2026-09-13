DOCE CASA STORE — HANDOFF PARA NOVA CONVERSA
Data: 12/09/2026
Objetivo: continuar o trabalho de correção completa do Doce Casa Store sem perder contexto.

1. OBJETIVO PRINCIPAL
Transformar o Doce Casa Store em uma versão V6.5 completa, estável e pronta para produção.
Fluxo desejado: trabalhar no GitHub -> testar/revisar -> colocar em main -> no servidor executar somente git pull (mais instalação/restart quando necessário).
Não alterar os robôs de cripto. O projeto alvo é somente FantasmaGH/doce-casa-store.

2. REPOSITÓRIO
GitHub: FantasmaGH/doce-casa-store
Main atual é a base V6.4 publicada no commit b77e97732ad0ecf6c6424b22193a6495f81416f6.
Branch de trabalho criada pelo usuário:
v6.5-correcoes-completas
A branch deve ser tratada como área de trabalho e não como produção.
O repositório é público. Nunca colocar .env, banco, WhatsApp auth, uploads reais ou outros segredos no Git.

3. SERVIDOR DE PRODUÇÃO
IP: 159.223.67.192
OS: Ubuntu 24.04.4 DigitalOcean
Projeto: /opt/doce-casa-store
DB correto: /opt/doce-casa-store/data/store.sqlite
Existe um store.db vazio que NÃO é o banco usado.
.env: /opt/doce-casa-store/.env, owner doceapp:doceapp, mode 600. NÃO sobrescrever.
WhatsApp auth: /opt/doce-casa-store/data/whatsapp-auth. NÃO apagar.
PM2:
- doce-casa-store (id 0)
- doce-casa-whatsapp (id 1)
Ambos devem rodar como doceapp.
Nunca usar pm2 restart all / pm2 kill.
Não reiniciar o servidor sem necessidade explícita.
Kernel tem atualização pendente; não rebootar por isso.
Porta app: 4173; WhatsApp: 4174 localhost.
Nginx/HTTPS já configurados.
PUBLIC_BASE_URL=https://159.223.67.192
REQUIRE_CATALOG_LINK=true

4. WHATSAPP
whatsapp-web.js 1.34.7
Puppeteer 24.38.0
Chrome/headless shell configurado.
WhatsApp ficou conectado e diagnosticado como READY/CONNECTED/hasSynced.
Correções importantes já existentes:
- resolução de LID para saída;
- resolução de telefone para entrada;
- cadastro obrigatório;
- aprovação de clientes;
- permissões de aprovação;
- auditoria;
- fluxo de cadastro 1/3, 2/3, 3/3, revisão, confirmação/correção/cancelamento;
- ADM/staff identificado antes do gate de cliente.
Não apagar cache/auth.

5. FUNCIONALIDADES JÁ EXISTENTES
Cliente:
- produtos
- campanhas
- status
- alteração de pedido
- atendente
Menu desejado final:
1 Produtos
2 Campanhas
3 Status
4 Alterar pedido
5 Atendente
Comprar pode permanecer apenas como alias/atalho interno, não como item visível duplicado.
Catálogo por link controlado, HTTPS.
Campanhas possuem fluxo próprio.
Pedidos normais possuem estoque, status, pagamento básico, vendedor e notificações.
Campanhas possuem fluxo de alteração mais completo.
ADM tem painel web com dashboard, produtos, vendas, suporte, auditoria, links, pedidos, operações, estoque, despesas, contas a pagar, funcionários, campanhas, pedidos de campanha, compras, WhatsApp e cadastros.

6. AUDITORIA FORMAL V6.4
A auditoria apontou 23/23 áreas revisadas.
Resultado quantitativo: 23/23 checks internos, 5/5 sintaxe, smoke tests aprovados, 9 vulnerabilidades npm (6 high, 3 moderate), 1 bug crítico e 4 gaps funcionais high.
Bug crítico:
- dupla conversão do custo nas faixas de preço:
  replacePriceTiers(..., cents(body.cost))
  e normalizePriceTiers(... cents(row.costCents ?? row.cost ?? fallbackCost))
- precisa garantir que fallback já está em centavos e não é convertido novamente.
Gaps high:
1 alteração estruturada de pedido normal ausente;
2 timeline/histórico de pedido normal ausente;
3 persistência de mensagens do atendimento ausente;
4 pagamento normal sem vencimento/lembrete/histórico completos.
Outros gaps:
- notificações incompletas;
- menu duplicado;
- duplicidades no admin.js/whatsapp-service.js;
- segurança/headers/CSRF/upload;
- foreign_keys/restore;
- HTTPS/Nginx/porta 4173/systemd;
- documentação antiga.

7. REQUISITOS APROVADOS PELO USUÁRIO
Implementar tudo em uma única rodada V6.5:
- correção de preço/custo;
- alterações estruturadas de pedido normal;
- regras por estágio;
- recálculo de total/estoque quando permitido;
- histórico/timeline;
- ID fácil de copiar e usar para acompanhamento;
- cliente aprender como consultar pedido;
- pagamento: valor a pagar, vencimento, confirmação, histórico, lembrete, idempotência, refund/cancelamento;
- após pago, não mandar lembrete;
- notificações automáticas de todas as etapas;
- separação;
- entrega;
- dados para entregador;
- atendimento centralizado pelo número Doce Casa;
- mensagens de atendimento persistentes;
- menu ADM numerado;
- cadastros/aprovação;
- vendas;
- auditoria;
- segurança;
- banco;
- infraestrutura;
- documentação;
- testes completos.

8. NOTIFICAÇÕES ESPERADAS
Cliente/equipe devem ter ciclo completo:
pedido recebido;
confirmado;
pagamento pendente;
lembrete de pagamento;
pagamento confirmado;
separação;
separado;
problema/missing;
pronto;
saiu para entrega;
entrega próxima (se implementada);
entregue;
concluído;
alteração solicitada;
alteração aprovada/rejeitada;
cancelamento;
atraso/incidente.
Evitar duplicidade de payment_paid e de lembretes.

9. BANCO
Schema existente inclui:
admins, products, product_price_tiers, stock_movements, expenses, payables, orders, order_items, settings, campaigns, campaign_products, suppliers, purchases, campaign_product_plans, staff_users, public_links, order_access_codes, audit_logs, notifications, support_tickets e outras tabelas existentes na versão do servidor.
Foreign keys devem permanecer ON.
Não confundir expenses com payables.
Não apagar dados de produção.

10. PAGAMENTOS
Pedido normal atualmente precisa evoluir para:
payment_due_date;
paid_at;
reminder tracking/idempotência;
payment history;
eventos de pagamento;
reembolso/cancelamento coerente;
valor devido claramente informado.
Campanhas já têm estrutura de pagamento mais rica e devem ser preservadas.

11. SUPORTE
Existe support_tickets, mas falta tabela persistente de mensagens.
Criar suporte de mensagens/histórico sem quebrar o roteamento central.
Comandos existentes incluem atendimentos, atender ATD-..., finalizar ATD-..., responder ATD-... texto.
Cliente não deve ser mandado para número pessoal do atendente.

12. SEGURANÇA
Já existem JWT, token interno, bcrypt, rate limit de login, normalização de telefones, SQL parametrizado, cookie HTTP-only.
Reforçar headers/Helmet-equivalente, CSRF onde aplicável, uploads e validações.
Não executar npm audit fix --force em produção.
Atualizações de dependências devem ser avaliadas/testadas, especialmente whatsapp-web.js/Puppeteer/sharp/express.

13. INFRA
Nginx já instalado.
HTTPS em https://159.223.67.192.
Certificado atual expira em 17/09/2026 e precisa de renovação/deploy hook.
Root / retorna 403 propositalmente.
Admin funciona.
Catálogo funciona por HTTPS.
Depois de validar, bloquear acesso público direto à 4173.
Não sobrescrever .env nem dados.
PM2 deve continuar isolado.

14. PROBLEMAS CONHECIDOS
Havia bug SQL 'ambiguous column name: id' em uma rota de links de catálogo no server.js; precisa ser rechecado e corrigido.
README/TESTES antigos na main precisam ser atualizados.
Audit scripts V6.5 existem na branch de trabalho.
A branch v6.5-correcoes-completas atualmente já contém arquivos adicionais V6.5 segundo a árvore do GitHub; antes de continuar, comparar branch com main e com o zip do servidor. Não assumir que a branch está 100% concluída.

15. ESTADO GITHUB OBSERVADO AGORA
A árvore da branch v6.5-correcoes-completas mostra, entre outros:
CORREÇÕES-V6.5.md
TESTES-V6.5.md
scripts/audit-v6.5.js
scripts/test-v65.js
server.js
whatsapp-service.js
public/admin.js
public/admin.html
package.json/package-lock.json
README.md
VERSAO.txt
e demais arquivos.
Isso significa que houve mudanças na branch e elas precisam ser auditadas contra o servidor antes de qualquer merge/deploy.

16. REGRA DE SEGURANÇA PARA NOVA CONVERSA
Primeiro comparar:
A) ZIP do servidor atual rodando;
B) ZIP da branch v6.5-correcoes-completas;
C) estado do main/commit b77e977.
Depois identificar exatamente o que diverge.
Só depois implementar/corrigir.
Nunca substituir produção com código não testado.
Nunca apagar .env, DB, uploads ou WhatsApp auth.
Nunca mexer nos robôs de cripto.

17. PRÓXIMO PASSO
Usuário quer enviar dois ZIPs para a nova conversa:
1) snapshot do projeto que está rodando no Termius/server;
2) snapshot exato da branch v6.5-correcoes-completas do GitHub.
Após receber os dois, fazer comparação completa, listar diferenças e continuar a V6.5 sem perder contexto.

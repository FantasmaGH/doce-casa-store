# Checklist V6.3 — Doce Casa Store

## Segurança e acesso

- [ ] `/` retorna 403 com `REQUIRE_CATALOG_LINK=true`.
- [ ] `/index.html` retorna 403.
- [ ] `/media/...` exige sessão de catálogo.
- [ ] APIs públicas de catálogo exigem sessão.
- [ ] Um token de catálogo só pode ser consumido uma vez.
- [ ] Segundo navegador usando a mesma URL recebe 410.
- [ ] Link expirado recebe 410.
- [ ] Porta 4174 não está exposta publicamente.
- [ ] `.env` e `data/whatsapp-auth` não são enviados no ZIP.

## Produtos e preços

- [ ] Custo interno é visível somente no admin.
- [ ] Preço de repasse é salvo.
- [ ] Preço do cliente é salvo.
- [ ] API pública não retorna custo nem preço de repasse.
- [ ] Pedido grava snapshot de preço do cliente, repasse e custo.
- [ ] Faixas públicas continuam recalculando no backend.
- [ ] Venda por link de vendedor exige repasse válido.

## Identidade da equipe

- [ ] Número cadastrado é normalizado.
- [ ] Funcionário recebe nome cadastrado no WhatsApp.
- [ ] Menu de funcionário é dinâmico.
- [ ] Número não cadastrado recebe somente menu cliente.
- [ ] Grupo do WhatsApp continua ignorado.
- [ ] Permissão é validada no backend.
- [ ] Atendimento é uma permissão separada.

## Vendedor

- [ ] `vender` gera link associado ao vendedor.
- [ ] Cliente abre o link e vê somente preços públicos.
- [ ] Pedido criado pelo link grava `salesperson_id`.
- [ ] Vendedor recebe aviso de nova venda.
- [ ] `produtos` mostra repasse e disponibilidade sem mostrar custo.
- [ ] `minhas vendas` calcula vendas, repasse e resultado vendedor.
- [ ] Cancelamento exclui a venda do resultado.

## Separação

- [ ] Pedido confirmado entra na fila de separação.
- [ ] Separador pode assumir.
- [ ] Outro separador não consegue assumir o mesmo pedido.
- [ ] `separado PED-...` finaliza a etapa.
- [ ] Evento fica registrado na auditoria.
- [ ] Entregadores recebem nova entrega.

## Entrega

- [ ] Entregador vê somente sua fila/entregas disponíveis.
- [ ] Endereço completo é mostrado.
- [ ] Observações de entrega são mostradas.
- [ ] `entregar PED-...` marca a caminho.
- [ ] Cliente recebe `🚚 Saiu para entrega`.
- [ ] `entregue PED-...` finaliza.
- [ ] Cliente recebe confirmação.

## Atendimento

- [ ] Cliente envia `6`.
- [ ] Ticket é criado.
- [ ] Funcionários com `canAttend` recebem aviso.
- [ ] Primeiro atendente autorizado assume.
- [ ] Outro atendente não pode assumir o ticket.
- [ ] `responder ATD-... texto` envia resposta.
- [ ] `finalizar ATD-...` fecha o ticket.
- [ ] Cliente é avisado do encerramento.
- [ ] Atendimento aparece no admin.

## Financeiro e auditoria

- [ ] Resultado do vendedor é separado do resultado da empresa.
- [ ] Custo interno permanece privado.
- [ ] Pagamento confirmado é separado do pedido criado.
- [ ] Despesas entram no resultado administrativo.
- [ ] Ações relevantes geram `audit_logs`.
- [ ] Vendedor, separador, entregador e atendente são identificados por ID.

## Formulários

- [ ] Telefone aceita colar com máscara.
- [ ] CEP aceita colar com hífen.
- [ ] Valores aceitam `10,50` e `10.50`.
- [ ] Estado pode ser selecionado.
- [ ] Endereço aceita colagem normal.
- [ ] Campos não bloqueiam `paste` por JavaScript.

## V6 — checklist adicional

### Campanhas
- Abrir somente por link `/campanha/<token>` gerado pelo painel/WhatsApp.
- Confirmar que `/api/public/campaigns/<id>` sem cookie de campanha retorna 403.
- Abrir link válido e confirmar que os produtos aparecem.
- Reabrir o mesmo link em nova sessão e confirmar que o link é de uso único.
- Criar pedido com produto de campanha e confirmar preço fixo.
- Confirmar que custo do produto nunca aparece no catálogo público.
- Confirmar quantidade mínima e limite disponível.
- Consultar pedido por número + telefone/código.
- Alterar pedido enquanto aberto.
- Aumentar pedido depois de pagamento e confirmar saldo restante.
- Tentar reduzir pedido abaixo do valor pago e confirmar bloqueio para aprovação administrativa.
- Marcar produção iniciada e confirmar bloqueio de edição do cliente.
- Registrar pagamento parcial/pago e data.
- Alterar disponibilidade individual do produto e conferir os itens do pedido.
- Editar campanha e seus produtos no painel.
- Tentar excluir produto de campanha já usado em pedido e confirmar bloqueio.

### Edições administrativas
- Editar membro da equipe e permissões.
- Editar despesa.
- Editar conta a pagar.
- Editar fornecedor.
- Editar compra.
- Editar campanha e produtos da campanha.

### Preservação
- Não substituir `.env`.
- Não substituir `data/store.sqlite`.
- Não remover `data/whatsapp-auth`.

## V6.2 checks
- [ ] Campanha: 100 unidades configuradas, pedidos concorrentes não ultrapassam 100.
- [ ] Alteração de pedido preserva preço original dos itens existentes.
- [ ] Disponibilidade de um item não altera outros pedidos.
- [ ] Parcial mostra quantidade disponível por item.
- [ ] Pagamento parcial mostra pago e saldo em centavos corretos.
- [ ] Redução abaixo do pago exige confirmação administrativa.
- [ ] Compra adicionada ao estoque cria movimento e edição reverte/reaplica corretamente.
- [ ] Despesa cancelada não entra no dashboard.
- [ ] Login bloqueia excesso de tentativas.


## V6.3 — fechamento

- [ ] Concorrência: dois pedidos simultâneos nunca ultrapassam a quantidade disponível da campanha.
- [ ] Produto de campanha indisponível não pode ser aumentado em pedido existente, mas permanece visível para consulta.
- [ ] Quantidade configurada da campanha não pode ficar abaixo do já reservado.
- [ ] Pagamento reduzido exige confirmação explícita e registra eventual estorno pendente.
- [ ] Disponibilidade do item não altera a disponibilidade de outros pedidos.
- [ ] Entrega da campanha usa `Aguardando / Em entrega / Entregue` separadamente da disponibilidade.
- [ ] Cancelamento de venda normal com estoque comprometido devolve estoque e registra movimento.
- [ ] Cancelamento de venda paga exige estorno.
- [ ] Dashboard inclui vendas de campanhas separadamente e no total geral.
- [ ] Atendimento só permite responder ao funcionário que assumiu o ticket.
- [ ] Testar backup e restauração do SQLite antes da operação definitiva.

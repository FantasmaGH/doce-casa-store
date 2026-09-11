# Doce Casa Store — V6.3 Operação Completa

Esta versão fecha o fluxo operacional da loja: cliente, vendedor, pagamento, produção, separação, entrega, atendimento, financeiro e auditoria.

## Regras principais

- Catálogo público somente por link controlado quando `REQUIRE_CATALOG_LINK=true`.
- Cada link é de uso único: o primeiro acesso consome o link e cria uma sessão temporária. Outra pessoa que tente abrir a mesma URL recebe 410 e deve solicitar outro link.
- Links podem ser gerados pelo administrador ou por um vendedor autorizado no WhatsApp. Links gerados por vendedor carregam a identidade do vendedor; pedidos feitos nessa sessão recebem `salesperson_id` automaticamente.
- O cliente vê somente preço público, disponibilidade e status do próprio pedido.
- O vendedor vê preço de cliente e preço de repasse, nunca o custo interno.
- Produto possui três valores: custo interno, preço de repasse ao vendedor e preço ao cliente.
- A margem do vendedor é `preço do cliente - preço de repasse`. A margem bruta da empresa antes de despesas é `preço de repasse - custo`.
- O backend recalcula preços e grava snapshots no pedido; valores exibidos pelo navegador não são confiáveis.
- O WhatsApp identifica funcionários pelo número cadastrado. Números não cadastrados recebem somente o menu público do cliente.
- Grupos do WhatsApp são ignorados pelo robô.
- Permissões são verificadas no backend, não somente no menu.
- O WhatsApp do administrador não recebe comandos administrativos por ser administrador; ele segue as permissões cadastradas para aquele número.
- O cliente recebe notificações simples de status, incluindo `🚚 Saiu para entrega`, sem expor dados desnecessários do entregador.
- A equipe recebe notificações operacionais pela fila interna do WhatsApp.
- Toda ação operacional importante pode ser registrada em `audit_logs`.

## Preços

No cadastro de produto:

1. **Custo interno** — somente administrador/financeiro.
2. **Preço de repasse** — usado para calcular o resultado do vendedor.
3. **Preço do cliente** — exibido no catálogo.

Exemplo:

- Custo: R$ 20,00
- Repasse: R$ 35,00
- Cliente: R$ 50,00
- Resultado vendedor: R$ 15,00
- Margem bruta da empresa: R$ 15,00

As faixas de preço por quantidade continuam disponíveis para o preço público. O custo nunca é enviado pela API pública.

## WhatsApp por identidade

### Funcionário cadastrado

`oi`, `menu`, `ajuda` ou `funções` exibem somente as funções autorizadas.

Vendedor:
- `vender` — gera catálogo de venda vinculado ao vendedor.
- `produtos` — mostra produtos, preço de repasse, preço público e disponibilidade.
- `minhas vendas` / `extrato` — mostra resultado do vendedor.

Separador:
- `fila`
- `separar PED-...`
- `separado PED-...`

Entregador:
- `entregas`
- `entregar PED-...`
- `entregue PED-...`

Atendimento:
- `atendimentos`
- `atender ATD-00001`
- `responder ATD-00001 texto`
- `finalizar ATD-00001`

Financeiro, quando permitido:
- `financeiro`

### Número não cadastrado

Recebe somente:

1. Comprar
2. Produtos
3. Campanhas
4. Status
5. Alterar pedido
6. Atendente

## Venda vinculada ao vendedor

O vendedor solicita `vender`. O serviço cria um link de catálogo associado ao ID do vendedor. O cliente abre esse link e faz a compra normalmente pelo catálogo público. Na criação do pedido, o servidor identifica o link usado na sessão e grava automaticamente o vendedor.

Isso evita o vendedor precisar digitar o próprio nome ou escolher manualmente o vendedor depois.

## Operação

Fluxo recomendado:

`venda → pedido → aprovação/pagamento → produção → separação → entrega → entregue → acerto financeiro`

- Pedido recebe vendedor, separador e entregador por IDs.
- Uma separação assumida não pode ser assumida por outro funcionário.
- Uma entrega assumida não pode ser assumida por outro funcionário.
- Quando a separação termina, a fila de entrega é alimentada.
- Quando sai para entrega, o cliente recebe `🚚 Saiu para entrega`.
- Quando entregue, o cliente recebe confirmação.

## Atendimento

O cliente envia `6` e o servidor abre um ticket. Todos os funcionários com permissão **Atendimento** recebem uma notificação. O primeiro autorizado a executar `atender ATD-00001` assume o chamado. O ticket fica associado ao cliente e ao pedido quando houver pedido.

O painel administrativo possui fila de atendimentos e histórico de auditoria.

## Auditoria

`audit_logs` registra ator, ação, entidade, ID e detalhes. Exemplos:

- venda registrada;
- funcionário cadastrado/alterado;
- separação assumida/concluída;
- entrega assumida/iniciada/concluída;
- atendimento aberto/assumido;
- status do pedido alterado;
- link criado.

## Formulários

Os formulários aceitam colagem e normalização de telefone/CEP. O cadastro de equipe remove caracteres não numéricos do telefone. CEP pode ser colado com ou sem hífen. Valores monetários aceitam vírgula ou ponto decimal.

Para produção, ainda é recomendável integrar consulta de CEP/endereçamento e validação de endereço antes de contratar uma API externa.

## Catálogo protegido

`REQUIRE_CATALOG_LINK=true` bloqueia a raiz `/` e `/index.html`. A rota `/catalogo/:token` aceita somente token existente, não usado e não expirado. O primeiro acesso marca o token como usado e cria o cookie temporário da sessão.

A porta interna do WhatsApp (`4174`) deve continuar somente em localhost.

## Backup

Faça backup de:

- `data/store.sqlite`
- `data/uploads/`
- `data/whatsapp-auth/`

Nunca envie `.env`, banco ou sessão do WhatsApp para repositório público.


## Gestão de campanhas e compras
A V4 possui fornecedores, histórico de compras, preço pago por unidade, compras vinculadas a campanhas, planejamento de produção, segurança de demanda, perdas, quantidade faltante e resultado financeiro por campanha.

## V6 — auditoria e campanhas

A V6 mantém a venda normal separada das campanhas. Campanhas possuem catálogo próprio, preço fixo, custo privado, mínimo, disponibilidade e pedidos próprios. Links públicos de campanha são tokens de uso único com expiração e o acesso às APIs da campanha depende da sessão criada pelo link.

Também foram acrescentadas/ajustadas rotinas administrativas de edição para equipe, despesas, contas a pagar, fornecedores, compras, campanhas e produtos de campanha.

## V6.2 — auditoria e consistência
- Reserva lógica de quantidade em campanhas para evitar overselling.
- Disponibilidade por item do pedido, sem alterar pedidos antigos globalmente.
- Snapshot de preço preservado ao editar pedidos.
- Pagamento parcial/complementar com centavos explícitos e histórico.
- Produção impede reabertura/edição sem confirmação administrativa.
- Compras com rastreio da quantidade aplicada ao estoque.
- Despesas arquivadas em vez de apagadas.
- Rate limit básico no login e segredos obrigatórios.
- Notificações de campanha incluem o link de acesso quando disponível.

## V6.3 — auditoria e produção

Esta versão consolida as correções de campanha, estoque, financeiro, edição, entrega, segurança e notificações. A campanha permanece independente do catálogo normal. O banco e o histórico devem ser preservados durante a implantação.

Antes de produção, execute `npm run audit` e os testes de homologação descritos em `TESTES.md`.

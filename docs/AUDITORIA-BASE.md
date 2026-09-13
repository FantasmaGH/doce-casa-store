# Auditoria completa — Doce Casa Store no GitHub

**Repositório auditado:** [FantasmaGH/doce-casa-store](https://github.com/FantasmaGH/doce-casa-store)  
**Branch:** `main`  
**Commit auditado:** `b77e97732ad0ecf6c6424b22193a6495f81416f6`  
**Data do commit:** 11 de setembro de 2026  
**Versão declarada:** `6.4.0`  
**Autor do relatório:** Manus AI

## 1. Conclusão executiva

O repositório público foi confirmado e contém o backend, frontend, painel administrativo, serviço WhatsApp Web, scripts, configuração PM2, documentação e arquivos de auditoria. A auditoria interna incluída no projeto passou **23/23 verificações**, e a sintaxe de `server.js`, `whatsapp-service.js`, `public/admin.js`, `public/store.js` e `public/campaign.js` foi validada com sucesso.

A base está funcional e possui uma arquitetura razoavelmente completa. O catálogo protegido, o cadastro/aprovação de clientes, as permissões da equipe, campanhas/rateios, estoque, contas a pagar, despesas, compras, operações de separação/entrega e integração com WhatsApp estão presentes.

Contudo, **não considero o repositório pronto para ser classificado como produção definitiva sem correções**. Foram encontrados problemas relevantes, principalmente um erro financeiro nas faixas de preço, ausência de histórico de mensagens do atendimento, ausência de alteração estruturada para pedidos normais, notificações incompletas de pagamento, documentação divergente, dependências vulneráveis e infraestrutura HTTPS/systemd não fechada no próprio repositório.

> **Achado mais importante:** ao cadastrar um produto com custo de R$ 4,50 e faixas de preço, o custo gravado nas faixas é convertido para `45000` centavos, equivalente a R$ 450,00, enquanto o custo principal do produto permanece R$ 4,50. Isso pode distorcer lucro, custo e resultado financeiro dos pedidos que utilizarem uma faixa.

## 2. Resumo quantitativo

| Indicador | Resultado |
|---|---:|
| Áreas auditadas | **23/23** |
| Checks internos do pacote | **23/23 aprovados** |
| Arquivos principais de código | Backend, WhatsApp, 3 frontends, scripts |
| Testes de sintaxe | **5/5 aprovados** |
| Smoke tests básicos HTTP | **Aprovados** |
| Vulnerabilidades npm | **9 totais: 6 altas, 3 moderadas** |
| Bugs críticos encontrados | **1 confirmado** |
| Gaps altos de produto | **4 confirmados** |
| Problemas médios/documentais/infraestrutura | **Vários** |

A contagem de “23/23” significa que as áreas foram examinadas; não significa que todas estejam completas. A classificação funcional está abaixo.

## 3. Matriz das 23 áreas

| Nº | Área | Situação | Conclusão da auditoria |
|---:|---|:---:|---|
| 1 | WhatsApp | 🟡 | Conexão, LocalAuth, QR, reconexão, LID e fila de notificações existem; há diagnóstico adicional, mas dependências e inicialização persistente ainda exigem homologação real. |
| 2 | Cadastro de clientes | 🟢 | Cadastro em três etapas, indicação, aprovação/rejeição, bloqueio de pendentes, persistência e auditoria estão implementados. |
| 3 | Menu do cliente | 🟡 | O código ainda exibe seis opções, incluindo “Comprar”, embora o menu definido mais recentemente seja de 1 a 5, com compra incorporada a Produtos. |
| 4 | Catálogo | 🟡 | Link individual, uso único, expiração, cookie, vendedor vinculado e proteção de APIs estão presentes; HTTPS é requisito operacional ainda não resolvido no pacote. |
| 5 | Campanhas | 🟢/🟡 | Estrutura é robusta: produtos próprios, preço, custo, mínimo, reserva, disponibilidade, pagamento parcial, produção, entrega, cancelamento e histórico. Falta homologação concorrente no servidor real. |
| 6 | Pedidos normais | 🟡 | Criação, código, endereço, snapshot, estoque, status, separação, entrega e cancelamento existem; faltam alteração estruturada e histórico próprio do pedido. |
| 7 | Rastreamento | 🔴/🟡 | Cliente recebe número/status simples. Não há timeline completa com pagamento, separação, incidentes, histórico e evolução detalhada. |
| 8 | Notificações automáticas | 🔴/🟡 | Existem notificações básicas de pedido, pagamento pago, preparo, entrega e atendimento; não há ciclo completo de vencimento, lembrete, atraso, alteração aprovada/recusada e entrega próxima. |
| 9 | Separação | 🟢/🟡 | Fila, permissão, assumir, impedir dupla atribuição, iniciar, concluir e auditoria existem. Tratamento detalhado de divergência/falta precisa de homologação e refinamento. |
| 10 | Entrega | 🟡 | Fila, atribuição, status, endereço, telefone e conclusão existem. A “rota” é ordenação heurística por UF/cidade/CEP/endereço, não rota geográfica otimizada. |
| 11 | Informações do entregador | 🟡 | Dados essenciais são retornados; é necessário confirmar em homologação se o entregador recebe exatamente observações, rota, telefone e valor sem dados internos indevidos. |
| 12 | Alteração de pedido | 🔴 | Existe edição pública avançada para campanhas, mas não existe rota equivalente de alteração estruturada para pedido normal. |
| 13 | Atendimento | 🟡/🔴 | Ticket, fila, atribuição, resposta encaminhada e encerramento existem; não existe tabela nem persistência de mensagens/conversa. |
| 14 | Menu ADM | 🟡 | Painel cobre os grandes módulos; foram encontradas funções duplicadas em `admin.js`, aumentando risco de manutenção e inconsistência. |
| 15 | Aprovação de clientes | 🟢 | Permissões separadas, painel, comando WhatsApp, auditoria e notificações estão presentes. |
| 16 | Vendas | 🟢/🟡 | Catálogo de vendedor, `salesperson_id`, preço de repasse, margem e extrato existem; o bug das faixas de custo compromete o resultado financeiro em alguns pedidos. |
| 17 | Auditoria/histórico | 🟡 | `audit_logs` registra ações importantes, mas isso não substitui uma timeline operacional completa do pedido normal nem histórico de mensagens. |
| 18 | Painel Web/Admin | 🟡 | Interface e endpoints principais existem; sintaxe passa, mas duplicidades e divergências de versão/documentação exigem limpeza. |
| 19 | Infraestrutura WhatsApp | 🟢/🟡 | PM2 isolado, LocalAuth, localhost, token interno e diagnóstico estão configurados; dependências Puppeteer/WhatsApp e persistência systemd permanecem riscos. |
| 20 | Infraestrutura servidor | 🟡 | Há configuração Nginx, mas com domínio placeholder, sem certificado/renovação/reload documentados e sem fechamento da porta pública 4173. |
| 21 | Segurança | 🟡 | JWT obrigatório, token interno, rate limit de login, cookies HTTP-only e validações existem; CSRF/headers de segurança não aparecem e há vulnerabilidades npm altas. |
| 22 | Banco de dados | 🟡 | Schema abrangente e migrações incrementais existem; não foi encontrado `PRAGMA foreign_keys = ON`, e o backup não inclui procedimento de restauração automatizado. |
| 23 | Regressões/documentação | 🔴/🟡 | Bug de custo por faixa confirmado; menu divergente, duplicidades e README/guia em V6.3/V4 apesar de `VERSAO.txt` 6.4.0. |

## 4. Testes executados

### 4.1 Auditoria interna e sintaxe

O comando `npm run audit` executou `scripts/audit-v64.js` e retornou **23/23 checks passed**. Os checks incluem schema de clientes, sessões persistentes, permissões de aprovação, flag administrativa do WhatsApp, identidade LID/telefone, cadastro obrigatório, bloqueio de pendentes, auditoria, UI administrativa, rota de campanha, proteção do token interno e sintaxe dos arquivos principais.

Também foram executados os seguintes checks de sintaxe:

```text
OK syntax server.js
OK syntax whatsapp-service.js
OK syntax public/admin.js
OK syntax public/campaign.js
OK syntax public/store.js
```

### 4.2 Smoke tests HTTP isolados

Em ambiente temporário, com banco separado e sem conexão WhatsApp, foram aprovados:

| Teste | Resultado |
|---|---:|
| `/api/health` | 200 |
| `/` com link obrigatório | 403 |
| `/api/public/products` sem cookie | 403 |
| Primeiro acesso ao token | 200 |
| Segundo acesso ao mesmo token | 410 |
| API pública com cookie do catálogo | 200 |
| Carrinho vazio | 400 |

Esses testes comprovam as barreiras básicas, mas não substituem o teste do QR, envio real, mensagens, campanhas concorrentes, upload real, restauração e operação completa no DigitalOcean.

## 5. Bug crítico confirmado: custo das faixas é multiplicado por 100

A função `cents()` transforma valores monetários em centavos. Entretanto, na criação do produto, a chamada é:

```js
replacePriceTiers(productId, body.priceTiers, cents(body.cost));
```

A função `replacePriceTiers` passa esse valor já convertido como `fallbackCost` para `normalizePriceTiers`, que novamente faz:

```js
costCents: Math.max(0, cents(row.costCents ?? row.cost ?? fallbackCost))
```

No teste isolado, o produto foi criado com custo principal de R$ 4,50. A resposta administrativa mostrou:

```text
produto.costCents = 450
faixa.costCents = 45000
faixa.cost = 450
```

Assim, a faixa registra R$ 450,00 em vez de R$ 4,50. O preço público continua correto, mas o custo e a margem dos pedidos que usam a faixa ficam incorretos.

**Prioridade:** crítica.  
**Correção recomendada:** definir explicitamente se `fallbackCost` recebe reais ou centavos e não converter duas vezes. Uma solução segura é fazer `normalizePriceTiers` receber `fallbackCostCents` e usar diretamente esse valor quando a faixa não tiver custo próprio, por exemplo:

```js
const fallbackCostCents = Number.isFinite(Number(fallbackCost))
  ? Math.max(0, Math.round(Number(fallbackCost)))
  : 0;

costCents: row.costCents === undefined && row.cost === undefined
  ? fallbackCostCents
  : Math.max(0, cents(row.costCents ?? row.cost));
```

Após corrigir, deve-se revisar também todas as faixas já cadastradas, pois dados históricos incorretos não serão reparados automaticamente.

## 6. Gaps funcionais de maior impacto

### 6.1 Pedido normal sem alteração estruturada

A rota pública de pedidos normais é `POST /api/public/orders`. A consulta é feita por `GET /api/public/order-status`, e a administração atualiza status/pagamento por `PATCH /api/admin/orders/:id`. Não existe uma rota pública equivalente a `PATCH /api/public/orders/:number` para alterar quantidade, produto, endereço ou observação com código de acesso, recálculo, verificação de pagamento, estoque e aprovação.

Campanhas possuem edição mais avançada, mas isso não atende pedidos normais. O WhatsApp apenas responde que o cliente deve explicar o que deseja à equipe.

### 6.2 Histórico do pedido normal insuficiente

Pedidos normais possuem `audit_logs` para algumas ações, mas não possuem tabela própria de histórico de pedido equivalente a `campaign_order_history`. O cliente recebe status atual, não uma linha do tempo completa. Para rastreamento profissional, recomenda-se criar `order_history` com ação, estado anterior, estado novo, ator, motivo e data.

### 6.3 Atendimento sem histórico de mensagens

O banco contém `support_tickets`, mas não foi encontrada tabela `support_messages` ou equivalente. A mensagem do cliente é encaminhada ao atendente em tempo real pelo WhatsApp; o conteúdo não é persistido como conversa. Isso impede auditoria completa, retomada do atendimento após reinício e consulta histórica pelo administrador.

### 6.4 Pagamento normal sem vencimento e lembrete

Pedidos normais têm `payment_method` e `payment_status`, mas o schema não apresenta `payment_due_date`, `payment_paid_at`, `payment_reminder_sent_at` ou histórico de pagamentos equivalente ao tratamento de campanhas. O backend notifica pagamento confirmado, porém não existe ciclo automático documentado de vencimento, lembrete e bloqueio de cobrança duplicada.

## 7. WhatsApp Web

O serviço possui `LocalAuth`, caminho configurável, QR, eventos `authenticated`, `ready`, `auth_failure`, `change_state`, `disconnected`, reconexão, resolução de LID de entrada e saída, cadastro de clientes, menu de equipe, vendedores, separadores, entregadores, atendentes, campanhas, status, fila de notificações e token interno.

Há uma instrumentação diagnóstica detalhada que grava eventos em `/opt/doce-casa-store/data/whatsapp-debug.log`, monitora `pupPage`, conexão do navegador, estado do socket e rejeições não tratadas. Isso é útil para o problema que ocorreu anteriormente com permissões.

O risco operacional permanece na árvore `whatsapp-web.js`/Puppeteer e no startup: o `ecosystem.config.cjs` inicia os processos PM2, mas não resolve sozinho a unidade systemd que havia sido observada como `inactive (dead)`. A sessão não deve ser apagada para “corrigir” uma falha sem antes guardar backup de `data/whatsapp-auth`.

O menu atualmente publicado é:

```text
1. Comprar
2. Produtos
3. Campanhas
4. Status
5. Alterar pedido
6. Atendente
```

Isso diverge do menu final definido pelo usuário, que deveria ser 1–5, deixando “Comprar” como atalho interno ou incorporado em “Produtos”. Além disso, `menuText` aparece definido duas vezes em `whatsapp-service.js`, e `saveStaff`, `saveSupplier` e `savePurchase` aparecem duplicadas em `public/admin.js`. A segunda definição prevalece em JavaScript; não é necessariamente uma falha imediata, mas é uma regressão de manutenção que deve ser removida.

## 8. Catálogo e privacidade

O fluxo de catálogo está bem protegido no desenho atual. A rota `/catalogo/:token` consulta o hash do token, exige que esteja não usado e não expirado, marca o link como consumido e cria cookie HTTP-only. As APIs públicas exigem a sessão criada pelo link. O smoke test confirmou 200 no primeiro acesso e 410 no segundo.

O código separa preço público, preço de repasse e custo interno. O teste público confirmou que a resposta de produtos não contém `cost`. O custo aparece em respostas administrativas, como esperado.

A propriedade `secure` do cookie depende de `NODE_ENV === 'production'`. Portanto, quando a aplicação estiver em produção, acesso direto por `http://IP:4173` não funcionará corretamente para cookies seguros. O uso recomendado é Nginx com HTTPS e `PUBLIC_BASE_URL` HTTPS. O arquivo Nginx publicado ainda usa `doces.seudominio.com` como placeholder, não contém TLS e não documenta Certbot, renovação ou reload.

A proteção contra screenshot não é tecnicamente garantível em navegador comum. O watermark reduz reutilização, mas não impede captura de tela.

## 9. Segurança

### Pontos positivos

O código exige segredo JWT e token interno sem fallback inseguro, usa bcrypt, possui rate limit básico no login, normaliza telefones, utiliza queries parametrizadas do SQLite, restringe o serviço WhatsApp a localhost por configuração, usa cookies HTTP-only e valida permissões no backend.

O scanner de XSS mostrou uso de funções de escape nos principais templates públicos e administrativos. Não foi identificado segredo real no conteúdo publicado; `.env.example` contém placeholders e `.gitignore` cobre `.env`, banco, sessão WhatsApp, uploads, logs e `node_modules`.

### Pontos pendentes

Não foram identificados headers de segurança equivalentes a Helmet nem proteção CSRF explícita. Como o painel usa autenticação por cookie e possui operações destrutivas/financeiras, recomenda-se adicionar CSRF token ou migrar a autenticação administrativa para um mecanismo que reduza o risco de requisições cross-site, além de `helmet`, política de origem e `SameSite` adequado.

O upload usa Multer/Sharp e limita tamanho, mas deve ser validado com arquivos reais, extensões adulteradas, imagens grandes, formatos HEIF/SVG e nomes de arquivo malformados. A atualização do Sharp deve ser feita em staging.

### Dependências vulneráveis

`npm audit --omit=dev` encontrou **9 vulnerabilidades: 6 altas e 3 moderadas**. Os principais grupos são:

| Pacote/grupo | Severidade | Observação |
|---|---:|---|
| `whatsapp-web.js` 1.34.7 | Alta | Cadeia vinculada ao Puppeteer |
| `puppeteer`, `puppeteer-core` | Alta | Cadeia `@puppeteer/browsers`/`extract-zip` |
| `extract-zip` | Alta | Vulnerabilidades de symlink/path traversal |
| `sharp` 0.33.5 | Alta | Vulnerabilidades herdadas de libvips/libheif |
| `express`/`body-parser`/`qs` | Moderada | Vulnerabilidades transitivas de `qs` |

Não recomendo executar `npm audit fix --force` diretamente em produção, porque a correção sugerida envolve mudança major do WhatsApp Web e pode quebrar QR, sessão, envio e reconexão. Deve ser criada uma cópia de staging, preservada a sessão original e testado o fluxo antes de promoção.

## 10. Banco, integridade e backup

O schema é abrangente e contempla produtos, faixas, estoque, pedidos normais, pedidos de campanha, campanhas, compras, fornecedores, despesas, contas a pagar, notificações, equipe, clientes, suporte e auditoria. Há migrações incrementais por `ensureColumn`.

O ponto pendente é que não foi encontrada ativação explícita de `PRAGMA foreign_keys = ON`. Em SQLite, a declaração de `FOREIGN KEY` não é suficiente se a conexão não habilitar a fiscalização; isso deve ser configurado e validado em cada conexão.

O backup SQLite usa `db.backup(destination)` e o script copia uploads e sessão WhatsApp. Porém, não existe comando de restauração automatizada nem teste de restauração documentado como procedimento executável. O backup deve ser restaurado periodicamente em diretório isolado, validando integridade SQLite, schema, arquivos de imagem e sessão.

A separação entre `expenses` e `payables` é conceitualmente válida: despesa representa gasto lançado; contas a pagar representam obrigação com vencimento. O código ainda precisa definir claramente quando um payable pago entra no resultado para evitar dupla contagem ou omissão.

## 11. Infraestrutura e implantação

O `ecosystem.config.cjs` isola os processos `doce-casa-store` e `doce-casa-whatsapp` sob `/opt/doce-casa-store`, com limites de memória, fork único e reinício automático. Isso é compatível com a exigência de não afetar os robôs de cripto, desde que o PM2 seja executado pelo usuário `doceapp` e não sejam usados comandos globais como `pm2 restart all` ou `pm2 kill`.

A documentação de implantação está desatualizada: o arquivo é intitulado **Implantação V4**, menciona ZIP V4 e contém instruções antigas, apesar de o código declarar 6.4.0. A configuração Nginx também está em estado de exemplo.

A recomendação operacional continua sendo usar um unit systemd com `pm2-runtime` em primeiro plano, `User=doceapp`, `PM2_HOME=/opt/doce-casa-store/.pm2`, `Restart=always` e sem `ExecStop=pm2 kill`. O repositório auditado não contém essa correção final do unit.

## 12. Correções prioritárias

| Prioridade | Correção | Impacto |
|---|---|---|
| P0 | Corrigir conversão dupla do custo nas faixas e revisar faixas já cadastradas | Evita lucro/custo financeiro incorreto |
| P0 | Fazer backup do banco, uploads, `.env` e sessão antes de qualquer atualização | Permite rollback seguro |
| P1 | Implementar alteração estruturada de pedido normal | Fecha requisito crítico de operação |
| P1 | Criar `order_history` e exibir timeline ao cliente/admin | Rastreabilidade e atendimento |
| P1 | Criar `support_messages` e persistir conversa | Auditoria e retomada de atendimento |
| P1 | Implementar vencimento, lembrete e histórico de pagamento normal | Evita cobrança duplicada e perda financeira |
| P1 | Fixar HTTPS/Nginx/Certbot e bloquear acesso público direto à 4173 | Segurança de sessão e produção |
| P1 | Atualizar dependências WhatsApp/Sharp/Express em staging | Reduz vulnerabilidades sem quebrar o bot |
| P2 | Remover funções duplicadas de `admin.js` e `whatsapp-service.js` | Manutenção e prevenção de regressão |
| P2 | Atualizar README, guia SFTP, TESTES e versão para 6.4 | Evita implantação errada |
| P2 | Habilitar `PRAGMA foreign_keys=ON` e testar restauração | Integridade do banco |
| P2 | Adicionar CSRF/Helmet/headers e testes de upload | Segurança de painel e mídia |

## 13. Ordem segura para corrigir

Primeiro, não altere o servidor de produção. Faça backup e copie a sessão WhatsApp. Depois corrija o bug das faixas em uma branch separada, escreva um teste que confirme que R$ 4,50 permanece 450 centavos em todas as faixas e execute os checks internos.

Em seguida, implemente o histórico e edição de pedido normal, atendimento persistente e pagamentos com vencimento. Só depois atualize dependências em staging, teste QR, `authenticated`, `ready`, envio de mensagens, notificações, LID, reconexão e recuperação após queda.

Por fim, prepare o unit systemd com `pm2-runtime`, configure HTTPS, bloqueie a porta 4173 externamente, valide o Nginx e promova apenas o código, preservando `.env`, `data/store.sqlite`, `data/uploads` e `data/whatsapp-auth`.

## 14. Parecer final

O repositório público é legítimo, está completo o suficiente para auditoria e contém uma base funcional avançada. O resultado real é:

> **23/23 áreas auditadas; 7 completas; 11 parciais; 5 ausentes ou defeituosas.**

A aplicação pode continuar sendo usada em homologação e operação controlada, mas a promoção final deve aguardar principalmente a correção do **custo das faixas**, pois esse defeito pode contaminar o lucro e o custo interno. Depois, devem ser tratados alteração/histórico de pedidos normais, histórico do atendimento, lembretes financeiros, HTTPS/PM2 persistente e dependências.

### Referências

[1]: https://github.com/FantasmaGH/doce-casa-store "Repositório público Doce Casa Store — commit b77e977"
[2]: https://docs.npmjs.com/cli/v10/commands/npm-audit "Documentação do npm audit"
[3]: https://github.com/advisories/GHSA-jmr9-qjv8-65gv "extract-zip symlink path traversal advisory"
[4]: https://github.com/advisories/GHSA-7pqw-9j4j-h8q3 "extract-zip arbitrary file write advisory"
[5]: https://github.com/advisories/GHSA-f88m-g3jw-g9cj "sharp/libvips advisory"
[6]: https://github.com/advisories/GHSA-rgj7-g3m4-5g8c "sharp/libheif advisory"

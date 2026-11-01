# Checkout Pix Grupo Pomar — v0.6

## Fluxo entregue

O proprietário cadastra cliente, contrato e parcelas na Central. Em **Cobranças → Gerar link**, confirma uma parcela e a validade. O servidor exige proprietário, sessão ativa e MFA recente, lê o saldo no banco e prepara um link privado em `/pagar/<token>`.

O cliente abre uma página independente com a identidade do Grupo Pomar, confere o valor e informa nome, e-mail e CPF/CNPJ numérico do pagador. O servidor cria o Pix via Mercado Pago Orders API. A página apresenta QR Code, Copia e Cola, validade e acompanhamento do status. O cartão não integra esta primeira etapa. Não existe cadastro público nem acesso do cliente à Central.

O valor é o saldo da parcela, definido pelo proprietário. O comprador não pode editar o valor, recebedor, referência, ambiente ou validade pelo navegador. Escolha livre de valor e seleção de múltiplas parcelas são evoluções que exigem uma regra comercial explícita.

## Diagnosticar a conexão

Com a sessão do proprietário e MFA, abrir `/api/billing/status`. A resposta inclui `enabled`, `mode`, um `code` estável e uma mensagem fixa. Falhas informam a etapa pendente: configuração da hospedagem, cadastro no banco, ambiente, vínculo do worker, migrações Pix, certificado TLS, autenticação, permissões ou rede. Respostas pendentes usam HTTP 503, exceto integração intencionalmente desativada. A tela de Cobranças mantém a criação bloqueada.

Em `configuration_invalid`, `fields` contém somente nomes conhecidos de variáveis. Nunca retornar nem registrar senha, token, URI, consulta ou o erro original do driver. O log `billing_readiness` contém apenas o código reconhecido. A rota exige o mesmo proprietário, sessão e MFA antes de projetar esse diagnóstico; requisições sem autorização conservam o erro de acesso anterior.

`worker_certificate_untrusted` exige conferir a CA oficial do Supabase e `POMAR_BILLING_DB_CA_BASE64`; não desabilitar a verificação TLS. `worker_authentication_failed` exige revisar privadamente usuário/senha do worker. `ready` confirma as verificações de conexão e configuração, não a homologação de pagamentos ou webhooks no Mercado Pago.

## Prévia visual

`/pagamento/visualizar` funciona sem credenciais. A faixa **PRÉVIA VISUAL** permanece visível. O botão **Ver aparência do Pix** mostra o segundo estado, com um marcador ilustrativo e sem código pagável. Essa página não faz chamadas de criação e não gera recebimentos. O valor de exemplo é fictício.

## Atualizar um Supabase já instalado

Se a instalação tem as três migrações originais, aplicar manualmente estes dois incrementos, em ordem, no mesmo projeto da Central:

1. `supabase/migrations/20261031204010_checkout_pix_pomar.sql`
2. `supabase/migrations/20261031215612_checkout_pix_orders.sql`

Se o primeiro incremento já foi aplicado, executar apenas o segundo. Não reaplicar as três migrações de instalação anteriores. A migração cria uma tabela privada com RLS habilitado/forçado e funções específicas; não altera o estado desativado de cobrança.

Conferência de estrutura, sem valores secretos:

```sql
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forcado
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='pomar_private' and c.relname='pix_checkouts';

select
  has_table_privilege('anon','pomar_private.pix_checkouts','select') as anon_le,
  has_table_privilege('authenticated','pomar_private.pix_checkouts','select') as usuario_le,
  has_table_privilege('pomar_billing_worker','pomar_private.pix_checkouts','select') as worker_le_tabela;
```

Esperado: RLS e RLS forçado `true`; as três permissões diretas `false`. O worker recebe somente USAGE do esquema e EXECUTE das funções delimitadas. Não conceder CRUD, superusuário ou `bypassrls`.

Instalações novas devem aplicar as cinco migrações em ordem e depois cadastrar o proprietário conforme `CONFIGURACAO.md`.

## Configurar Mercado Pago e worker

1. Na conta que receberá os pagamentos, confirmar a chave Pix cadastrada e a habilitação para o produto. Criar/selecionar uma aplicação de **Checkout Transparente → API de Orders**. A criação usa `POST /v1/orders`, com um único Pix e `processing_mode=automatic`. O painel passou a avisar sobre a descontinuação de Payments; essa API permanece somente para consultar pagamentos numéricos legados.
2. Seguir a documentação atual da aplicação para a conta/credenciais de teste. Copiar as credenciais com o seletor **Teste**. O prefixo `APP_USR` também é usado em teste e não prova produção. Configurar o ID da conta de teste correspondente e o Application ID. A aplicação confere o perfil autenticado em `/users/me` (ID, país e marcador `test_user`) antes de criar; confere novamente `user_id`, `country_code` e `integration_data.application_id` na order. A ausência desses campos ou divergência impede o processamento; conferir o retorno real durante a homologação. Não trocar para live apenas para contornar uma falha de teste.
3. Configurar o evento **Order (Mercado Pago)**, tópico `order`, do webhook com o endereço HTTPS `/api/webhooks/mercadopago` da mesma origem. Guardar a assinatura secreta diretamente na hospedagem.
4. Configurar o worker PostgreSQL restrito seguindo `COBRANCA_E_PAGAMENTOS.md` e `supabase/03_cobranca_configuracao.sql`. Seu usuário do pooler é `pomar_billing_worker.PROJECT_REF`, com TLS e certificado verificado. A aplicação não usa senha administrativa, `postgres`, `service_role` ou chave `sb_secret_...`.
5. Definir as variáveis abaixo diretamente no painel de hospedagem. Access Token, assinatura, URI e senha nunca entram em Git, prints ou conversa. Não são variáveis `NEXT_PUBLIC_`.

| Variável                     | Uso                                                        |
| ---------------------------- | ---------------------------------------------------------- |
| `POMAR_BILLING_ENABLED`      | `true` somente quando a configuração estiver pronta.       |
| `POMAR_PAYMENT_MODE`         | `test` na homologação; `live` apenas no recebimento real.  |
| `POMAR_MP_ACCESS_TOKEN`      | Token privado da aplicação e do ambiente escolhido.        |
| `POMAR_MP_WEBHOOK_SECRET`    | Assinatura privada do webhook dessa aplicação.             |
| `POMAR_MP_COLLECTOR_ID`      | ID do recebedor do ambiente: conta de teste ou conta real. |
| `POMAR_MP_APPLICATION_ID`    | Application ID conferido no GET da order.                  |
| `POMAR_BILLING_DATABASE_URL` | URI privada do pooler com o papel restrito.                |
| `POMAR_BILLING_DB_CA_BASE64` | CA do projeto, quando necessária para validar TLS.         |

O modo e o recebedor também precisam corresponder à configuração privada no banco. **Cobranças** só habilita a criação após conferir a migração Pix, a configuração e o worker. Alterações de ambiente precisam de nova publicação.

## Validação antes de receber clientes

1. Cadastrar um contrato de teste e gerar seu link com MFA recente. Abrir em janela sem sessão e em celular: somente o pagamento pode aparecer.
2. Conferir valor e validade, informar dados de teste autorizados e gerar o Pix. Testar CPF/CNPJ inválido e ausência de campos sem enviar dados reais como teste.
3. Repetir o botão/abrir outra aba: o pedido utiliza a mesma chave e o mesmo corpo previamente armazenado; não deve produzir um segundo pagamento.
4. Simular a confirmação conforme o ambiente oficial e verificar o webhook. Conferir novamente na página. Um teste aprovado não pode gerar recebimento real, quitar parcela ou entrar no caixa.
5. Conferir link inválido, expirado, cobrança encerrada, saldo alterado e provedor indisponível. Nunca mostrar pago por um parâmetro de URL ou ação do navegador.
6. Validar status e recebimento na Central. Uma confirmação real repetida deve produzir exatamente um recebimento e uma alocação, com o valor original preservado.

Os testes automatizados do repositório usam respostas controladas de API e PostgreSQL via PGlite. Eles não comprovam a elegibilidade da conta, a liquidação bancária, entrega real de webhooks ou concorrência entre conexões de produção. Esses pontos exigem homologação no serviço real.

Os testes do worker também usam o driver Postgres.js instalado sobre o protocolo PostgreSQL do PGlite, com `prepare=false`. Isso verifica o formato dos parâmetros realmente enviados às funções de início e confirmação. Objetos JSONB devem usar `sql.json(objeto)`: aplicar `JSON.stringify` antes desse binding faz o driver enviar uma string JSON e o banco rejeitar o comando. O teste reproduz essa rejeição e confirma início, aprovação de teste sem caixa e confirmação live fictícia idempotente. Esse transporte local não homologa autenticação, TLS ou o pooler remoto.

Para homologar Pix em Teste, seguir o [roteiro oficial de teste Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix): valor `50.00`, primeiro nome `APRO` e e-mail `test_payer@example.com`. A aprovação é automática nesse cenário; não efetuar pagamento em banco real. Se um envio anterior já tiver persistido outro pagador, não alterar a chave idempotente ou a tentativa para forçar a troca: conferir primeiro o estado e a resposta do provedor.

## Ativar operação real

Após a homologação e a decisão de usar o banco na operação: configurar credenciais produtivas, `POMAR_ENVIRONMENT=production`, `POMAR_PAYMENT_MODE=live`, `POMAR_BILLING_LIVE_CONFIRMED=yes` e modo/recebedor correspondentes no banco. Conferir domínio HTTPS, worker e webhook novamente. As credenciais básicas existentes do Supabase permanecem do mesmo projeto.

Confirmar com um pagamento controlado, iniciado pelo próprio responsável fora da automação, e conferir recebedor, valor, status aprovado, recibo único, alocação e saldo. Não enviar links a clientes nem tratar essa implementação como cobrança ativa antes dessa validação.

## Segurança e recuperação

- Links usam 32 bytes aleatórios. O lookup usa SHA-256; a URL completa fica no registro da cobrança, acessível ao proprietário por RLS. O link funciona como uma autorização limitada ao pagamento: compartilhar somente com o pagador.
- O cliente recebe uma projeção pequena: valor, referência curta, validade, estado e dados do QR quando pendente. Não recebe cliente/contrato interno, observações, UUID do proprietário, histórico, ID do pagamento ou dados de outro pagador.
- Cada criação Pix tem `X-Idempotency-Key` estável por cobrança. Uma resposta incerta conserva o primeiro pagador para repetir o mesmo corpo, com limite de 20 tentativas e intervalo mínimo de 20 segundos no banco. O prazo em segundos é persistido com o primeiro pagador, conservando corpo e chave mesmo após timeout. Os dados temporários do pagador são removidos após vincular o ID da order. Após timeout ou conflito de idempotência, o servidor procura a referência exata e só recupera uma order única conferida por GET. Não muda a chave para forçar uma nova criação. Uma criação assíncrona mantém esse ID e a página acompanha seu processamento; não cria outro pedido só porque o QR ainda não chegou. Tentativas abandonadas devem integrar a política privada de retenção; limpar dados temporários após o prazo operacional sem apagar registros financeiros.
- A conferência pública só consulta o pagamento já vinculado àquele link, com intervalo mínimo de 20 segundos no banco. Não permite escolher um ID de pagamento arbitrário. O webhook continua exigindo HMAC válido e consulta autenticada ao provedor.
- O QR não fica disponível em cobranças pagas, encerradas, expiradas ou divergentes do saldo atual. Se um QR já copiado for pago após uma baixa manual, a conciliação registra a divergência para revisão; não duplica a alocação.
- A duração do Pix respeita o mínimo de 30 minutos. A criação começa somente com pelo menos 31 minutos restantes; a duração inicial reserva 60 segundos para a comunicação e permanece estável nas repetições. A página usa o menor prazo entre a cobrança e a expiração devolvida pelo provedor. Um timeout anterior à criação efetiva pode fazer o código bancário durar além do link; ocultar ou expirar a página não cancela o Pix remoto. Tratar cancelamento e pagamentos tardios pelo provedor e conciliação.
- O retorno antigo `/pagamento/retorno` não confirma pagamento. Cancelamentos, devoluções e revogação de credenciais continuam seguindo o procedimento do provedor e o guia de cobrança. Desativar a aplicação não cancela um Pix já emitido remotamente.
- Não há analytics, pixels, SDK de cartão ou recursos remotos na página. Links/API usam `no-store`, `no-referrer`, CSP e proteção contra iframe. Dados de pagamento não são persistidos em localStorage.

## Confirmação financeira e datas

Orders confirma status e valores no GET autenticado, mas seu contrato documentado não informa a data original de aprovação nem a data individual de cada devolução. `last_updated_date` registra a atualização da order e **não é usado como data do recebimento ou estorno**. Se o retorno real incluir uma data explícita de aprovação/devolução válida, ela é conferida. Caso contrário:

- Pagamento `processed/accredited` com valor exato confirma ao pagador que o pagamento foi recebido e remove o QR. Na Central, permanece em conciliação com **Data de aprovação não confirmada**, sem criar caixa nem quitar a parcela.
- O proprietário confere a data no Mercado Pago e, em **Cobranças → Conciliação**, informa **Data do recebimento conferida no Mercado Pago → Confirmar data e conciliar**. A rota exige MFA recente, busca novamente a order e só permite essa confirmação para pagamento aprovado sem devolução. O banco valida a pendência, o proprietário e o saldo, registra a confirmação em auditoria e cria um único recebimento. Repetir não duplica.
- A data já confirmada é preservada nos eventos seguintes. Devolução sem suas datas/detalhes completos fica em revisão, sem lançar um estorno com data inventada. A confirmação manual de datas de devolução pela interface ainda não integra esta versão; homologar o retorno real e fechar esse procedimento antes de operar devoluções reais.

A aprovação do teste continua sem caixa real. Não ativar recebimento real antes de testar todo o fluxo da própria conta, inclusive a confirmação de data, as notificações e a rotina de devolução.

## Fontes oficiais consultadas

- [Pix via Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix)
- [Migração de Payments para Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders)
- [Obter order por ID](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/get-order/get)
- [Credenciais por ambiente](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials)
- [Notificações Order](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)
- [Assinatura de notificações](https://www.mercadopago.com.br/developers/pt/docs/wallet-connect/notifications)

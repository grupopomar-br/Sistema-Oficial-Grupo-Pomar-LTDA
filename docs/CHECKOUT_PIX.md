# Checkout Pix Grupo Pomar — v0.5

## Fluxo entregue

O proprietário cadastra cliente, contrato e parcelas na Central. Em **Cobranças → Gerar link**, confirma uma parcela e a validade. O servidor exige proprietário, sessão ativa e MFA recente, lê o saldo no banco e prepara um link privado em `/pagar/<token>`.

O cliente abre uma página independente com a identidade do Grupo Pomar, confere o valor e informa nome, e-mail e CPF/CNPJ numérico do pagador. O servidor cria o Pix via Mercado Pago Payments API. A página apresenta QR Code, Copia e Cola, validade e acompanhamento do status. O cartão não integra esta primeira etapa. Não existe cadastro público nem acesso do cliente à Central.

O valor é o saldo da parcela, definido pelo proprietário. O comprador não pode editar o valor, recebedor, referência, ambiente ou validade pelo navegador. Escolha livre de valor e seleção de múltiplas parcelas são evoluções que exigem uma regra comercial explícita.

## Prévia visual

`/pagamento/visualizar` funciona sem credenciais. A faixa **PRÉVIA VISUAL** permanece visível. O botão **Ver aparência do Pix** mostra o segundo estado, com um marcador ilustrativo e sem código pagável. Essa página não faz chamadas de criação e não gera recebimentos. O valor de exemplo é fictício.

## Atualizar um Supabase já instalado

Aplicar manualmente **somente** `supabase/migrations/20261031204010_checkout_pix_pomar.sql` no mesmo projeto da Central. Não reaplicar as três migrações de instalação anteriores. A migração cria uma tabela privada com RLS habilitado/forçado e funções específicas; não altera o estado desativado de cobrança.

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

Instalações novas devem aplicar as quatro migrações em ordem e depois cadastrar o proprietário conforme `CONFIGURACAO.md`.

## Configurar Mercado Pago e worker

1. Na conta que receberá os pagamentos, confirmar a chave Pix cadastrada e a habilitação para o produto. Criar/selecionar uma aplicação de **Checkout Transparente via Payments API**. A criação direta usa `POST /v1/payments`; não usa Orders nem dados de cartão.
2. Seguir a documentação atual da aplicação para a conta/credenciais de teste. Usar pagador de teste e conferir `live_mode=false`. A API desta aplicação recusa divergência de recebedor e ambiente. Não trocar para live apenas para contornar uma falha de teste.
3. Configurar o evento **payment** do webhook com o endereço HTTPS `/api/webhooks/mercadopago` da mesma origem. Guardar a assinatura secreta diretamente na hospedagem.
4. Configurar o worker PostgreSQL restrito seguindo `COBRANCA_E_PAGAMENTOS.md` e `supabase/03_cobranca_configuracao.sql`. Seu usuário do pooler é `pomar_billing_worker.PROJECT_REF`, com TLS e certificado verificado. A aplicação não usa senha administrativa, `postgres`, `service_role` ou chave `sb_secret_...`.
5. Definir as variáveis abaixo diretamente no painel de hospedagem. Access Token, assinatura, URI e senha nunca entram em Git, prints ou conversa. Não são variáveis `NEXT_PUBLIC_`.

| Variável                     | Uso                                                       |
| ---------------------------- | --------------------------------------------------------- |
| `POMAR_BILLING_ENABLED`      | `true` somente quando a configuração estiver pronta.      |
| `POMAR_PAYMENT_MODE`         | `test` na homologação; `live` apenas no recebimento real. |
| `POMAR_MP_ACCESS_TOKEN`      | Token privado da aplicação e do ambiente escolhido.       |
| `POMAR_MP_WEBHOOK_SECRET`    | Assinatura privada do webhook dessa aplicação.            |
| `POMAR_MP_COLLECTOR_ID`      | Identificador do recebedor esperado.                      |
| `POMAR_BILLING_DATABASE_URL` | URI privada do pooler com o papel restrito.               |
| `POMAR_BILLING_DB_CA_BASE64` | CA do projeto, quando necessária para validar TLS.        |

O modo e o recebedor também precisam corresponder à configuração privada no banco. **Cobranças** só habilita a criação após conferir a migração Pix, a configuração e o worker. Alterações de ambiente precisam de nova publicação.

## Validação antes de receber clientes

1. Cadastrar um contrato de teste e gerar seu link com MFA recente. Abrir em janela sem sessão e em celular: somente o pagamento pode aparecer.
2. Conferir valor e validade, informar dados de teste autorizados e gerar o Pix. Testar CPF/CNPJ inválido e ausência de campos sem enviar dados reais como teste.
3. Repetir o botão/abrir outra aba: o pedido utiliza a mesma chave e o mesmo corpo previamente armazenado; não deve produzir um segundo pagamento.
4. Simular a confirmação conforme o ambiente oficial e verificar o webhook. Conferir novamente na página. Um teste aprovado não pode gerar recebimento real, quitar parcela ou entrar no caixa.
5. Conferir link inválido, expirado, cobrança encerrada, saldo alterado e provedor indisponível. Nunca mostrar pago por um parâmetro de URL ou ação do navegador.
6. Validar status e recebimento na Central. Uma confirmação real repetida deve produzir exatamente um recebimento e uma alocação, com o valor original preservado.

Os testes automatizados do repositório usam respostas controladas de API e PostgreSQL via PGlite. Eles não comprovam a elegibilidade da conta, a liquidação bancária, entrega real de webhooks ou concorrência entre conexões de produção. Esses pontos exigem homologação no serviço real.

## Ativar operação real

Após a homologação e a decisão de usar o banco na operação: configurar credenciais produtivas, `POMAR_ENVIRONMENT=production`, `POMAR_PAYMENT_MODE=live`, `POMAR_BILLING_LIVE_CONFIRMED=yes` e modo/recebedor correspondentes no banco. Conferir domínio HTTPS, worker e webhook novamente. As credenciais básicas existentes do Supabase permanecem do mesmo projeto.

Confirmar com um pagamento controlado, iniciado pelo próprio responsável fora da automação, e conferir recebedor, valor, status aprovado, recibo único, alocação e saldo. Não enviar links a clientes nem tratar essa implementação como cobrança ativa antes dessa validação.

## Segurança e recuperação

- Links usam 32 bytes aleatórios. O lookup usa SHA-256; a URL completa fica no registro da cobrança, acessível ao proprietário por RLS. O link funciona como uma autorização limitada ao pagamento: compartilhar somente com o pagador.
- O cliente recebe uma projeção pequena: valor, referência curta, validade, estado e dados do QR quando pendente. Não recebe cliente/contrato interno, observações, UUID do proprietário, histórico, ID do pagamento ou dados de outro pagador.
- Cada criação Pix tem `X-Idempotency-Key` estável por cobrança. Uma resposta incerta conserva o primeiro pagador para repetir o mesmo corpo, com limite de 20 tentativas e intervalo mínimo de 20 segundos no banco. Os dados temporários do pagador são removidos após vincular o QR confirmado. Tentativas abandonadas devem integrar a política privada de retenção; limpar dados temporários após o prazo operacional sem apagar registros financeiros.
- A conferência pública só consulta o pagamento já vinculado àquele link, com intervalo mínimo de 20 segundos no banco. Não permite escolher um ID de pagamento arbitrário. O webhook continua exigindo HMAC válido e consulta autenticada ao provedor.
- O QR não fica disponível em cobranças pagas, encerradas, expiradas ou divergentes do saldo atual. Se um QR já copiado for pago após uma baixa manual, a conciliação registra a divergência para revisão; não duplica a alocação.
- A expiração do Pix segue a validade da cobrança, respeitando o mínimo de 30 minutos exigido pela API. Nos últimos 30 minutos não se gera um novo QR; solicitar outro link ao proprietário. O código já emitido mantém sua validade real.
- O retorno antigo `/pagamento/retorno` não confirma pagamento. Cancelamentos, devoluções e revogação de credenciais continuam seguindo o procedimento do provedor e o guia de cobrança. Desativar a aplicação não cancela um Pix já emitido remotamente.
- Não há analytics, pixels, SDK de cartão ou recursos remotos na página. Links/API usam `no-store`, `no-referrer`, CSP e proteção contra iframe. Dados de pagamento não são persistidos em localStorage.

## Fontes oficiais consultadas

- [Pix via Payments API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix)
- [Pré-requisitos e chave Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/prerequisites)
- [Requisitos de produção](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-test/go-to-production-requirements)
- [Webhooks e assinatura](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/optional-notifications)

# Cartão em até 12 parcelas

Implementação preparada para **Checkout Pro via Preferences API**, com finalização no ambiente do Mercado Pago. A página do Grupo Pomar oferece a escolha antes de iniciar o pagamento. O cliente confere as parcelas, acréscimos e total no provedor; não se promete 12 opções em qualquer valor/bandeira nem parcelamento sem juros.

O Mercado Pago também pode oferecer dinheiro em conta, opção que sua documentação informa não poder ser excluída. Os demais tipos que a API informar são excluídos da preferência, preservando cartão de crédito e dinheiro em conta. A Central nunca recebe número, validade ou código de segurança do cartão.

**Estado da entrega:** código com testes locais de provedor simulado e PostgreSQL 17. Pagamento real/sandbox no Mercado Pago, condições comerciais e retorno no celular ainda exigem homologação. A opção começa desativada por padrão; Pix permanece independente.

A prévia visual `/pagamento/visualizar` permite conferir Pix e cartão com dados fictícios, sem gerar cobrança nem redirecionar para pagar. A abertura, o contador e a conferência ao voltar do banco estão descritos em [CHECKOUT_DESEMPENHO.md](CHECKOUT_DESEMPENHO.md). A prévia não substitui a homologação no provedor.

## Ativação em ambiente isolado

1. Use uma implantação de homologação e um banco de testes próprios, com registros fictícios, cadeia de migrações e credenciais de teste do mesmo vendedor/aplicação. Não mude o modo nem as credenciais da produção que já possui cobranças Pix em andamento.
2. Aplique [checkout_cartao_parcelado](../supabase/migrations/20261103042134_checkout_cartao_parcelado.sql) após resultados/avisos. O papel financeiro permanece restrito, sem CRUD. O script não gera preferência, não cobra e não habilita cartão por conta própria.
3. Em homologação, configure `POMAR_CARD_CHECKOUT_ENABLED=true`. Não é necessária Public Key para este fluxo de redirecionamento; o Access Token fica no servidor.
4. Configure a notificação **Pagamentos** no Mercado Pago, mantendo **Orders** do Pix. A URL continua `/api/webhooks/mercadopago`; conferir assinatura e ambiente com a aplicação de teste.
5. Usando as [orientações oficiais de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases), testar aprovação, recusa, nova tentativa no provedor, retorno interrompido, reentrega de webhook, consulta de recuperação, expiração e liberação do dinheiro. Não usar dados de cartão ou pagamentos reais nos testes locais.
6. Conferir na conta os custos de processamento e parcelamento e o prazo de liberação. Verificar que o provedor mostra as opções corretas antes de pagar.
7. Somente após homologar o fluxo, ativar em Production com `POMAR_CARD_CHECKOUT_ENABLED=true` e `POMAR_CARD_LIVE_CONFIRMED=yes`, publicar nova implantação e conferir a disponibilidade. A documentação não substitui essa validação na conta.

## Proteções do fluxo

- Valor, referência e validade vêm da cobrança no banco; não são aceitos no POST público. URL de retorno fixa para o link privado atual. Parâmetros de retorno não confirmam pagamento.
- Conta, aplicação, moeda, item, valor, validade, URL e limite de parcelas da preferência são conferidos antes de exibir o endereço do Mercado Pago.
- Pix e cartão usam a mesma reserva persistente do meio escolhido. Uma tentativa Pix com resultado incerto também bloqueia a troca para cartão. Não se cancela ou substitui um Pix existente automaticamente.
- A preferência só é mostrada depois de persistida. Reserva com lease e limite de tentativas impede respostas atrasadas de substituir uma preferência já salva. Uma preferência órfã de uma falha de servidor não é devolvida ao cliente.
- Webhook assinado e consulta autenticada verificam cada pagamento. O retorno pode recuperar pagamentos da referência armazenada; buscas incompletas, valores divergentes e identidades inesperadas são recusados. Recusa de outra tentativa não apaga o recebimento confirmado.
- Pagamento no cartão aprovado não entra no caixa apenas por `date_approved` ou por previsão de liberação. Exige `money_release_status=released` com data de liberação válida e passada, ou conferência de data pelo proprietário depois de a disponibilidade estar confirmada. Ausência de evidência mantém o valor em conciliação, com ação **Conferir liberação**.
- Recebimentos são brutos, taxas ficam no registro do provedor e devoluções permanecem eventos próprios. Não se divide o contrato em 12 recebimentos pela quantidade de parcelas do cartão. Aprovação não é prova de depósito bancário.
- Metadados de cartão usam tabela separada e snapshot versionado, mantendo o formato antigo dos pagamentos. O SQL impede um adaptador antigo de lançar como caixa uma aprovação de cartão sem evidência de disponibilidade.

## Pausa e continuidade

Para suspender novas adesões ao cartão, desative `POMAR_CARD_CHECKOUT_ENABLED` e publique novamente. Links já iniciados preservam sua leitura, URL preparada e consulta de confirmação. Não remova as funções/tabelas enquanto existirem pagamentos em andamento e não volte a um adaptador antigo que não entende a liberação do cartão; os guardas SQL recusam eventos incompletos. Uma cobrança encerrada localmente pode ainda ter sido aberta no provedor; pagamentos posteriores vão para conferência segundo as regras financeiras existentes.

Referências: [preferências e meios de pagamento](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/payment-methods), [criar preferência](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/create-preference/post), [obter pagamento](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/get-payment/get).

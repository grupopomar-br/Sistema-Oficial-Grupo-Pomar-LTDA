# Evolução controlada da Central

## Implementado na v0.4

- Caixa de ideias com captura rápida, classificação e conversão única em tarefa.
- Central de Cobranças: vencimento, saldo, atraso, contatos e promessas informadas.
- Condições propostas/aceitas, entrada antes do início e quitação antes da conclusão.
- Adaptador Mercado Pago Checkout Pro, desligado por padrão, com webhook validado, consulta ao provedor, worker restrito e conciliação transacional.
- Separação entre teste e dinheiro real; devoluções em eventos próprios.
- Sessão com duração máxima, bloqueio por inatividade e MFA recente para operações de cobrança.
- Navegação inferior para celular e módulos carregados sob demanda.

## Próxima passagem: homologação da fundação

Configurar manualmente o Supabase do projeto correto, conferir conta exclusiva/MFA/RLS e recuperação, revisar os advisors, testar no dispositivo real e medir os fluxos com volume representativo. Depois resolver a autorização do GitHub, comparar o estado remoto e sincronizar a branch sem sobrescrever trabalho existente. Hospedagem e domínio continuam em etapa própria.

## Antes de dados bancários de maior risco

Definir exatamente quais dados precisam ficar na aplicação, quem pode vê-los, por quanto tempo e por qual motivo. Preparar um cofre separado com criptografia autenticada por campo/envelope, chave fora do banco de dados, identificação de versão da chave, rotação, recuperação ensaiada, acesso sob MFA recente e auditoria também das leituras/revelações. As exportações comuns não devem revelar automaticamente o conteúdo do cofre.

Essa etapa não está pronta. Notas gerais e o banco operacional não devem ser tratados como um cofre. Credenciais de internet banking e dados de cartão pertencem a fluxos próprios de provedores/cofres apropriados; não criar campos genéricos para coletá-los sem uma necessidade e um desenho específico.

## Depois da homologação de pagamentos

Avaliar recorrência/assinaturas, integração de mensagens autorizadas, modelos de serviços/onboarding, relatórios de resultado e outras automações. A escolha de provedor e cada ação externa entram com escopo, critérios de aceite, custo e autorização. Stripe é uma opção futura, sem adaptador implementado nesta entrega.

## Critério para uma nova ideia

Registrar problema, resultado esperado, impacto, dados envolvidos, dependências e condição de aceite. Priorizar o que reduz risco, protege recebimento ou destrava entrega. Uma ideia capturada não se torna compromisso de execução automaticamente.

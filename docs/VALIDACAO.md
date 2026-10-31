# Registro de validação — v0.4

Validação local realizada em 29/10/2026. As evidências são reproduzíveis pelos comandos do projeto.

## Cobertura automatizada

- Conversão monetária BRL, limites de precisão e datas civis/fuso America/Fortaleza.
- Distribuição de centavos em 1 a 120 parcelas e manutenção de vencimentos mensais.
- Separação de contrato, recebimento e previsão; recebimento parcial; repetição idempotente; rejeição de excesso e data futura.
- Conciliação sem criar outro recebimento, estorno, cancelamento e preservação do histórico.
- Conflito de edição, foco limitado, alertas derivados, conclusão de tarefa e conversão sem duplicar projeto.
- Backup com validação de vínculos/valores e CSV protegido contra fórmula.
- Configuração de produção, rejeição de chaves secretas e redirecionamento externo, bloqueio do modo local em produção.
- Migração SQL executada em PostgreSQL via PGlite: RLS para proprietário, outro usuário, anônimo, `aal1` e sessão inexistente/removida; permissões de auditoria; comandos reais e snapshot convertido para o modelo da aplicação.
- Invariantes financeiras no PostgreSQL, conflitos de versão e transações revertidas quando inválidas.
- Sessão iniciada sob MFA recente, bloqueio por inatividade e limite de 8 horas e expiração antecipada `not_after` do Auth conferidos no PostgreSQL.
- Caixa de ideias e conversão única em tarefa; condições comerciais propostas/aceitas e transições de projeto protegidas no domínio e no banco.
- Criação de checkout com saldo do banco, prevenção de criação simultânea, conta/ambiente conferidos e estado incerto sem retry cego.
- HMAC: ID, request ID e timestamp vinculados; parâmetros repetidos, assinatura adulterada e timestamp futuro negados.
- Consulta autenticada com verificação de recebedor, moeda, ambiente e valor; dados do pagador não persistidos pelo normalizador.
- Worker sem leitura de tabelas nem permissão de assumir o papel de usuário da aplicação.
- Pagamento repetido e evento antigo sem duplicação/retrocesso, devolução parcial em evento próprio, saldo reaberto e original preservado.
- Pagamentos de teste sem recebimento/caixa real; rascunhos sem sandbox ou URL com valor antigo; referência fora da Central ignorada.

O teste SQL usa roles e funções controladas que representam o Auth. Não autentica contra o serviço Supabase, não envia e-mails e não prova concorrência real em múltiplas conexões. Use homologação para esses testes.

## Build e servidor

`npm run verify` executa a suíte, build de produção e TypeScript. `npm run test:production` confirma, sem credenciais, que `/local` retorna 404, as APIs recusam acesso sem configuração e as respostas possuem nonce por requisição/cache privado.

Resultados obtidos nesta sessão:

| Verificação                | Resultado                                |
| -------------------------- | ---------------------------------------- |
| `npm run test`             | 39 testes passaram                       |
| `npm run build`            | Build de produção concluído              |
| `npm run typecheck`        | Sem erros de TypeScript                  |
| `npm run test:production`  | Bloqueios e cabeçalhos HTTP conferidos   |
| `npm run format:check`     | Formatação aprovada                      |
| `npm run audit:production` | 0 vulnerabilidades conhecidas reportadas |

A auditoria deve ser repetida no CI, pois os avisos de segurança mudam ao longo do tempo.

## Interface e ambiente real

Na sessão anterior (v0.3), o desenvolvimento respondeu HTTP 200 em `/local` e nos seis arquivos JavaScript referenciados, mas o teste interativo não foi concluído. Na v0.4, o launcher da prévisualização anunciou o servidor, depois encerrou; o navegador recebeu `ERR_CONNECTION_REFUSED`, e a consulta de estado confirmou servidor parado. Não foi alterada a rede nem criado outro caminho de controle de navegador.

**Os fluxos interativos completos, a persistência pelo navegador e o layout em um celular real não foram aprovados nesta sessão.** A navegação inferior, áreas de toque e layouts responsivos foram implementados e compilados, sem apresentar isso como medição de desempenho móvel ou aceite visual.

O projeto Supabase real não foi criado nem modificado por esta entrega. Login, TOTP, recuperação de senha, cookies, RPCs via PostgREST, conexão TLS do worker, notificações reais do Mercado Pago, persistência entre dispositivos e o fluxo real navegador → aplicação → Supabase permanecem pendentes da configuração manual e da homologação.

Nenhum pagamento real foi criado, enviado, aprovado ou devolvido por esta entrega. O cofre bancário específico e uma auditoria independente de segurança continuam fora do que foi validado.

Não foi realizada publicação em hospedagem nem conexão de domínio/DNS. Estes limites devem ser resolvidos antes de colocar dados reais em produção.

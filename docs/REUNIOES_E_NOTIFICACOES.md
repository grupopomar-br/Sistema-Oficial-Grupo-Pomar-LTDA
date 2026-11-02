# Reuniões e notificações

A agenda é privada do proprietário. Registra título, início/fim, cliente/projeto opcionais, local/link, participantes, pauta, decisões e próximos passos. Os horários seguem America/Fortaleza (Brasília). Há filtros de próximas, hoje, realizadas, canceladas e todas, com pesquisa. A edição permite reagendar, concluir ou cancelar; os registros e o histórico são preservados. Cadastrar participantes não envia convites ou mensagens.

Cada reunião permite escolher lembrete de **1 hora**, **2 horas** ou nenhum. Só mudanças de horário, situação ou antecedência renovam a revisão do lembrete. Alterar a pauta não gera outro aviso. Cancelamentos e reagendamentos invalidam a entrega anterior antes do envio; uma notificação já recebida no aparelho não pode ser recolhida retroativamente.

## O que gera aviso de pagamento

A fila lê pagamentos que a integração já conferiu no provedor: modo live, status aprovado, cobrança vinculada e valor correspondente. Sandbox, retorno do comprador e um contrato recém-cadastrado não geram aviso de venda. O fluxo financeiro permanece independente da entrega de avisos.

Aprovações existentes na instalação entram em uma baseline privada, para evitar notificações retroativas. Uma aprovação nova gera um único aviso por pagamento, mesmo com consultas ou webhooks repetidos. Aprovação sem data financeira ainda pode precisar da conciliação em Cobranças; o aviso não substitui esse procedimento.

## Canais

- **Na Central:** sino e aba Notificações, com filtros, contagem de não lidos e marcação de leitura. A consulta ocorre ao abrir e periodicamente durante atividade; não mantém uma sessão ociosa viva.
- **No aparelho:** Web Push criptografado, mediante ativação explícita em cada navegador/aparelho. A mensagem externa é genérica, sem valores, nomes de clientes, pauta ou documentos na tela bloqueada. Ao tocar, a Central exige seu acesso normal.
- A ativação permite avisos em segundo plano até desativar o aparelho ou revogar sua permissão. O limite é de dez aparelhos ativos. Não há e-mail, WhatsApp ou convite automático nesta entrega.

No iPhone, use iOS 16.4 ou posterior, adicione a Central à Tela de Início e abra por esse ícone para ativar os avisos. Em navegadores compatíveis Android/desktop, ative em Notificações. A PWA tem manifesto e ícones da marca; o service worker trata apenas push e não armazena páginas ou respostas privadas para uso offline.

## Ativação manual

1. Aplique a cadeia anterior de migrações, incluindo conclusão de projetos e personalização, caso ainda ausentes. Depois, execute uma vez [reunioes_e_notificacoes](../supabase/migrations/20261102180603_reunioes_e_notificacoes.sql) no projeto da Central. O script cria a agenda, avisos, fila e papel `pomar_notification_worker` sem login por padrão.
2. Recarregue a Central. Agenda e avisos internos ficam disponíveis com a migração. Sem a migração, o aplicativo mantém o snapshot anterior e informa que o recurso aguarda ativação; só a ausência do RPC permite fallback.
3. No seu computador, gere as chaves uma vez com `node scripts/notification-keys.mjs`. Guarde o resultado de forma privada. Configure na Vercel as variáveis listadas em `.env.example`: habilitação, chaves VAPID pública/privada, segredo do agendador e URI do pooler para o MESMO projeto, com usuário `pomar_notification_worker.PROJECT_REF`. Nunca use `postgres`, `service_role` ou chave administrativa. O certificado CA, se necessário, pode ser o mesmo do projeto já usado na cobrança.
4. No SQL Editor, como administrador do projeto, use [o modelo protegido de habilitação](../supabase/06a_habilitar_worker_notificacoes.sql), substituindo a senha somente no editor privado. O modelo recusa o exemplo e valores curtos. Use essa senha na URI do pooler. Não publique o comando preenchido em repositório, chat ou issue. O papel não recebe CRUD, somente os três RPCs de entrega delimitada.
5. Publique novamente a aplicação com as variáveis. Ative Cron, pg_net e Vault no Supabase. No Vault, crie `pomar_notifications_app_url` com a origem HTTPS da Central e `pomar_notifications_cron_secret` com o MESMO segredo configurado na Vercel.
6. Execute [06_configurar_agendador_notificacoes.sql](../supabase/06_configurar_agendador_notificacoes.sql). Ele cria/atualiza o job por nome, a cada minuto, e restringe a leitura da fila HTTP que pode conter o cabeçalho de autorização. Revise os advisors do Supabase após a configuração.
7. No aparelho, abra Notificações, escolha **Ativar neste aparelho** e autorize. Use **Enviar aviso de teste**. Confira a notificação nativa e o histórico do job. O teste não cria venda ou cobrança. A primeira execução bem-sucedida deve aparecer no serviço; se não houver execução recente, confira o agendador antes de depender dos lembretes.

O plano Vercel Hobby limita seu cron nativo a uma execução diária; por isso o agendamento por minuto fica no Supabase. O job chama uma rota autenticada por segredo próprio, sem usar a sessão do proprietário. O código não altera remotamente as configurações das contas.

## Entrega, segurança e limites

A fila tem chave única por evento/aparelho, seleção com SKIP LOCKED, lease e confirmação vinculada à tentativa. Uma chamada repetida não seleciona novamente uma entrega em andamento. Falhas temporárias são reagendadas com espera progressiva e limite de cinco tentativas; 404/410 desativam o endpoint. O envio verifica a validade e a situação atual da reunião antes de acionar o serviço. A expiração é o início da reunião ou a janela do evento; o TTL do push é limitado a uma hora e ao tempo restante.

Como em outros sistemas Web Push, uma queda entre a aceitação do provedor de push e a confirmação no banco pode exigir reenvio. A tag estável substitui a apresentação anterior do mesmo evento no aparelho; não se promete entrega exatamente uma vez. Não há promessa de pontualidade ou entrega se o dispositivo estiver sem conexão, com permissão negada, restrição do sistema operacional ou serviço indisponível.

A agenda usa RLS forçado, auditoria e conflito de edição. Avisos não podem ser fabricados pelo navegador; somente a leitura pode ser marcada. Tokens de aparelhos ficam em esquema privado. O worker não lê tabelas de clientes, financeiro ou agenda diretamente. Endpoints push são limitados aos provedores reconhecidos (Google, Mozilla, Apple e Windows); URLs locais, credenciais e portas alternativas são rejeitadas. Erros de envio retornam contagens, sem registrar tokens ou conteúdo sensível.

Os testes usam PostgreSQL 17, cenários fictícios e envio push controlado. A instalação do SQL, o agendador, o aparelho real e a permissão nativa exigem conferência após a configuração manual. Nenhuma notificação externa foi enviada durante os testes locais.

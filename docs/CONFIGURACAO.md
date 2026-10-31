# Configuração manual do Supabase

Este procedimento deve ser feito no **projeto novo destinado à Central Operacional**. Nenhum projeto anterior precisa ser reutilizado. A criação da conta do Supabase e a autenticação da aplicação são coisas distintas. A cobrança é opcional e continua desativada até a configuração em `COBRANCA_E_PAGAMENTOS.md`.

## 1. Preparar projeto e acesso administrativo

1. Crie o projeto na organização da empresa. Escolha uma região adequada à operação e guarde a senha do banco em um gerenciador de senhas.
2. Proteja a conta administrativa do Supabase e a conta do GitHub com segundo fator. Guarde códigos de recuperação fora do mesmo dispositivo.
3. No Supabase, em Authentication, desabilite novos cadastros públicos e login anônimo. Mantenha apenas o provedor de e-mail/senha necessário.
4. Habilite MFA por aplicativo autenticador (TOTP). Não dependa de SMS para acessar este sistema.
5. Em Authentication > Users, crie manualmente o único usuário proprietário, com seu e-mail e uma senha forte. Para esse usuário criado pelo administrador, confirme o e-mail pelo procedimento do painel. Anote o **User ID/UUID**, não o ID da organização.

Não envie senha, chave secreta, token administrativo ou códigos do autenticador pelo chat ou pelo Git.

## 2. Criar a estrutura

No SQL Editor do projeto correto, execute os arquivos completos nesta ordem:

```text
supabase/migrations/20261028225524_central_operacional_v1.sql
supabase/migrations/20261029150132_sessoes_e_cobranca.sql
supabase/migrations/20261029150348_checkout_mercadopago.sql
```

Essas migrações criam tabelas prefixadas `pomar_`, políticas de acesso, restrições financeiras, auditoria e RPCs. Foram preparadas para um banco novo. Execute cada uma uma vez; o procedimento não apaga tabelas existentes nem faz alterações destrutivas em projetos antigos.

Depois abra:

```text
supabase/02_proprietario.sql
```

Substitua somente `00000000-0000-0000-0000-000000000000` pelo UUID do usuário criado em Authentication > Users e execute. O script recusa o placeholder, usuário inexistente ou a troca de um proprietário já definido. Ele cria preferências e três áreas genéricas; não inclui clientes nem movimentações financeiras.

A sessão exige TOTP recente ao abrir, expira após 8 horas desde o login e é bloqueada após 15 minutos sem atividade registrada no servidor. Uma sessão expirada exige novo login. Gerar checkout ou reconciliar pagamento exige TOTP nos últimos 5 minutos.

A aplicação exige que o UUID em `POMAR_OWNER_USER_ID` e o proprietário definido no banco sejam o mesmo. Mantenha `pomar_private` fora dos schemas expostos pela Data API. Não conceda permissões adicionais a `anon`, `authenticated` ou `PUBLIC` para contornar erros.

## 3. Variáveis no computador

Copie `.env.example` para `.env.local` e preencha localmente:

| Variável                               | Conteúdo                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL do projeto novo                                                                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública no formato `sb_publishable_...`                                                           |
| `NEXT_PUBLIC_APP_URL`                  | Origem exata usada para abrir a aplicação, sem caminho. Ex.: `http://localhost:3000` em desenvolvimento |
| `POMAR_ENVIRONMENT`                    | `development` no computador, `staging` em homologação, `production` na operação                         |
| `POMAR_OWNER_USER_ID`                  | UUID do único proprietário, somente no ambiente do servidor                                             |

A chave pública é destinada à aplicação; a segurança dos dados depende das políticas de proprietário, segundo fator e sessão ativa. Esta implementação não precisa de `sb_secret_...`, `service_role`, senha do banco ou token administrativo. O servidor valida a configuração e recusa formatos inadequados.

Reinicie `npm run dev` após mudar as variáveis. Uma configuração incompleta da nuvem gera uma tela de configuração/erro; não muda silenciosamente para um banco local.

## 4. URLs de autenticação e e-mail

No painel de autenticação:

- Configure **Site URL** com a origem exata do ambiente.
- Autorize o callback de recuperação: `ORIGEM/auth/callback?next=/nova-senha`. Por exemplo, em desenvolvimento: `http://localhost:3000/auth/callback?next=/nova-senha`.
- Ao mudar para HTTPS/domínio final, cadastre o callback correspondente e remova URLs de teste que deixarem de ser usadas. Evite curingas amplos em produção.
- Configure SMTP sob controle da empresa e teste a entrega do e-mail de recuperação. Verifique os limites de envio e autenticação do projeto.

A recuperação usa PKCE: solicite e abra o link no mesmo navegador em que iniciou o pedido. A troca de senha também exige o segundo fator. Perda do autenticador exige recuperação administrativa; não existe atalho público para remover MFA.

## 5. Primeiro login e conferência

1. Abra `/entrar` e use o usuário criado manualmente.
2. Configure o aplicativo autenticador, guarde sua configuração de recuperação em local protegido e confirme o código de seis dígitos.
3. Confira que a Central abriu vazia, com suas áreas genéricas, sem exemplos fictícios.
4. Cadastre um cliente de teste, projeto e tarefa. Recarregue e confira persistência.
5. Registre um contrato de teste de R$ 100,01 em três parcelas e confira a soma. Registre um recebimento parcial; veja o saldo e a entrada no mês correto.
6. Confira conciliação sem duplicação, estorno, cancelamento e histórico. Somente depois comece a inserir registros reais.
7. Saia e teste que `/central` e as APIs exigem nova autenticação. Confira o Security Advisor e o Performance Advisor no painel.

Use registros explicitamente marcados como teste na homologação; a aplicação preserva lançamentos financeiros por correção/estorno em vez de apagá-los. A validação de login, e-mail, TOTP e REST no serviço real ainda precisa ser feita após esta configuração.

## 6. Hospedagem e domínio, em etapa posterior

A aplicação precisa de um servidor compatível com Next.js. Configure as mesmas variáveis no ambiente escolhido, com `POMAR_ENVIRONMENT=production` e `NEXT_PUBLIC_APP_URL=https://SEU-DOMINIO`. Execute `npm run preflight:release`, `npm run verify` e `npm run test:production` no fluxo de entrega.

As variáveis `NEXT_PUBLIC_` participam do build; refaça o build ao alterá-las. Não entregue `.env.local` junto com o código. Um build/servidor de produção nunca disponibiliza `/local`, mesmo que alguém tente acessar o endereço diretamente.

No Registro.br, configure DNS somente quando a hospedagem fornecer os destinos corretos. Preserve MX/TXT e demais registros usados por e-mail ou outros serviços. Ative HTTPS na hospedagem, ajuste os callbacks e teste antes de usar o domínio na operação. Não foi realizada configuração de Vercel, Registro.br, DNS ou cobrança de plano.

## Referências oficiais

- [Supabase: preparação para produção](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase: MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: URLs de redirecionamento](https://supabase.com/docs/guides/auth/redirect-urls)

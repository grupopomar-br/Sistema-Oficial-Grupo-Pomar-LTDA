# Segurança e continuidade

O objetivo é restringir o acesso ao proprietário e permitir evolução sem perder o código nem o contexto. A implementação oferece controles verificáveis; não é uma garantia de segurança absoluta ou uma auditoria independente.

## Controles implementados — v0.4

| Controle                | Implementação                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Proprietário exclusivo  | UUID no servidor e registro privado no banco; nenhum uso de `user_metadata` para autorização                              |
| Segundo fator           | TOTP e exigência de `aal2` tanto nas verificações do servidor quanto no RLS                                               |
| Sessão limitada         | 8 horas desde criação no Auth, 15 minutos de inatividade no banco, bloqueio de tela e coordenação de atividade entre abas |
| Confirmação de operação | TOTP nos últimos 5 minutos para checkout e reconciliação                                                                  |
| Sessão ativa            | `getUser` e claims verificados; política consulta existência da sessão no Auth                                            |
| Dados privados          | RLS ativado e forçado em todas as tabelas `pomar_`; sem permissões de tabela para `anon`                                  |
| Escrita                 | Validação Zod, lista fixa de comandos/colunas, versão por registro e transação no banco                                   |
| Financeiro              | Centavos inteiros, soma de parcelas/alocações verificada, bloqueio de sobrepagamento e preservação de originais           |
| Tentativas repetidas    | UUID de comando e conteúdo comparados no mesmo RPC/transação                                                              |
| Histórico               | Triggers gravam alterações; usuário da aplicação não pode inserir, alterar ou excluir eventos de auditoria                |
| Sessão no navegador     | Cookies HttpOnly, SameSite=Lax e Secure fora do desenvolvimento                                                           |
| Requisições             | Verificação de Origin nas escritas, JSON limitado a 512 KB e redirecionamentos internos fixos                             |
| Respostas               | Cache privado/no-store, CSP com nonce por resposta, bloqueio de frame e orientação de não indexar                         |
| Exportações             | JSON validado e neutralização de fórmulas em células CSV                                                                  |
| Credenciais             | Sem segredo administrativo no código ou no cliente; `.env.local` ignorado pelo Git                                        |

A política de scripts de produção não usa `unsafe-eval`; o desenvolvimento precisa dessa permissão para a ferramenta do framework. Estilos inline são permitidos para indicadores/estilos do React. Não há scripts de analytics, CDN de fontes nem envio automático de dados a outros serviços.

Os helpers `SECURITY DEFINER` possuem funções delimitadas: conferir proprietário/sessão em tabelas privadas do Auth, administrar a guarda de sessão, gravar auditoria/avançar revisão e processar comandos específicos de cobrança. As funções do worker exigem o papel de conexão restrito, com conta, ambiente e proprietário fixados. Todos usam `search_path` vazio e acesso limitado. Comandos comuns e snapshot são `SECURITY INVOKER`, sujeitos ao RLS. A preparação de checkout exige proprietário e MFA recente; a conciliação técnica não utiliza a sessão do proprietário. As exceções e o roteiro estão em `COBRANCA_E_PAGAMENTOS.md`.

## Contas e recuperação

Mantenha em um gerenciador sob seu controle: acesso do GitHub, Supabase, e-mail e Registro.br; método de recuperação de cada conta; identificação do proprietário do projeto e do repositório; cópia protegida do autenticador. Esses dados nunca devem constar neste repositório público nem em issues.

Teste a recuperação enquanto ainda possui acesso. Se perder o autenticador da aplicação, utilize o acesso administrativo protegido do Supabase para recuperar o fator do usuário correto pelo procedimento oficial. A aplicação não permite remover MFA com uma simples recuperação de senha. Se perder o acesso administrativo, a recuperação depende da conta/provedor; o código não consegue substituí-la.

O registro privado do proprietário pode ser desativado por um administrador no banco, interrompendo o acesso às tabelas. A troca de proprietário não é uma preferência comum: deve ser feita em procedimento separado, preservando referências e validando acessos. O script inicial recusa substituir outro proprietário.

## Cópias e restauração

Defina uma rotina de backup compatível com o volume e o plano escolhido no Supabase. Verifique a retenção real do projeto e teste uma restauração em ambiente separado. Git guarda código e migrações, não os registros financeiros. O JSON operacional da interface contém dados privados e histórico limitado; não é um dump completo do PostgreSQL/Auth.

Antes de uma atualização, preserve código, migrações aplicadas e cópia do banco. Não edite uma migração já aplicada para mudar um ambiente em uso; crie uma nova migração. Não execute comandos de reset/exclusão para resolver falhas de acesso.

## Limites da primeira versão

- Proprietário único; não há permissões para uma equipe ou outras empresas.
- Snapshot integral consistente, com limites de 100 áreas; 20.000 tarefas/parcelas/recebimentos/alocações/atualizações; 10.000 registros por outra coleção operacional. A leitura falha explicitamente se exceder o limite, para não apresentar totais incompletos. Evoluir para consultas/paginação no servidor conforme o volume crescer.
- Paginação visual não é paginação do banco. Desempenho real de rede, consultas e concorrência precisa ser medido em homologação.
- A interface mostra 1.000 eventos de histórico mais recentes. O banco preserva os demais. O espaço local guarda somente 1.000 eventos e as 500 chaves recentes de idempotência; as atualizações de projeto ficam em sua própria coleção.
- O modo local é exclusivo de desenvolvimento; não é sincronizado nem usado como contingência automática da nuvem.
- Não há restauração JSON na nuvem, anexos, faturamento fiscal, integração bancária ou execução automática de pagamentos.
- Proteção distribuída contra abuso depende também dos limites do Auth, configurações e controles da hospedagem. Não há promessa de rate limit próprio no servidor da aplicação.
- Login, entrega de e-mail, MFA, políticas no serviço real, papel restrito, integração de pagamentos e fluxos visuais completos ainda precisam de validação após a configuração manual.
- O cofre para informações bancárias de maior risco, criptografia de campo/gestão de chaves e auditoria de segurança independente não foram implementados ou concluídos. Não há base para prometer segurança absoluta.

Antes da operação real, mantenha cadastro público desabilitado, revise os advisors do Supabase e teste os fluxos com seu usuário. Transforme o repositório em privado como planejado e mantenha alterações revisáveis por branch/PR. Não exponha dados privados no histórico do Git.

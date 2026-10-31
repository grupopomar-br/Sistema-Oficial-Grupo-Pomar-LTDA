# Central Operacional Pomar — v0.4

Sistema interno do Grupo Pomar para um único proprietário. Reúne direção diária, relacionamento, execução, comercial e financeiro. Interface em português, com layout adaptável e estrutura preparada para Supabase.

**Estado desta entrega:** implementação de código e banco com 39 testes automatizados locais. Inclui cobrança, captura de ideias e reforço de sessão. O Supabase real será configurado manualmente. Hospedagem e domínio ainda não estão conectados. A validação interativa completa no navegador permanece pendente; veja [o relatório de validação](docs/VALIDACAO.md).

## O que já foi implementado

| Área         | Recursos                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visão geral  | Foco diário limitado, projetos prioritários, indicadores e pontos de atenção derivados dos registros                                                  |
| Clientes     | Cadastro, edição, busca, arquivamento e projetos relacionados                                                                                         |
| Projetos     | Áreas, contratante, cliente, prioridade, prazo, próxima ação, dependências e atualizações completas                                                   |
| Tarefas      | Estados, prioridade, prazo, reserva no foco do dia, conclusão e reabertura                                                                            |
| Comercial    | Etapas, previsão de contato, valor estimado e conversão em projeto sem criar receita automaticamente                                                  |
| Cobranças    | Faixas de atraso, entrada/entrega condicionadas ao aceite e pagamento, promessas, histórico de contatos e rascunhos revisáveis                        |
| Ideias       | Captura rápida, classificação, prioridade e conversão única em tarefa                                                                                 |
| Pagamentos   | Adaptador Mercado Pago Checkout Pro, validade real, assinatura de webhook, consulta autenticada e conciliação idempotente; desativado até homologação |
| Financeiro   | Contratos, parcelas mensais, recebimentos parciais, conciliação, estornos, cancelamento e despesas                                                    |
| Alertas      | Prazos, cobranças, esperas e acompanhamento comercial; origem acessível pelo alerta                                                                   |
| Histórico    | Eventos gravados pelo banco na nuvem e pelo domínio no desenvolvimento local                                                                          |
| Preferências | Empresa, nome de exibição, áreas, foco diário, backup JSON e exportação financeira CSV                                                                |
| Acesso       | Login do proprietário, TOTP, sessão limitada a 8h, inatividade de 15min no banco e MFA recente para gerar links e reconciliar pagamentos              |

Não há cadastro público, acesso de equipe nem portal de clientes nesta versão. O repositório contém somente código, documentação técnica e exemplos fictícios. Dados de operação não devem ser enviados ao Git.

## Começar no computador

Use **Node.js 24 LTS** e npm. Na pasta do projeto:

```sh
npm ci
npm run preflight
npm run dev
```

Abra o endereço informado no terminal, normalmente `http://localhost:3000`. Sem configuração de nuvem, o desenvolvimento usa `/local` e salva no IndexedDB daquele navegador. O aviso de modo local permanece visível. Não use esse espaço como base definitiva da empresa; exporte cópias quando necessário.

Em Preferências, **Carregar exemplos** aparece somente quando o espaço local está vazio. Os exemplos são fictícios e nunca são inseridos automaticamente no Supabase.

Para conectar o banco, siga [CONFIGURACAO.md](docs/CONFIGURACAO.md). A integração de pagamento é opcional e tem roteiro próprio em [COBRANCA_E_PAGAMENTOS.md](docs/COBRANCA_E_PAGAMENTOS.md). Para entender os fluxos, veja [GUIA_DE_USO.md](docs/GUIA_DE_USO.md).

## Verificações

```sh
npm run verify
npm run test:production
npm run format:check
npm run audit:production
```

`verify` executa testes de domínio/configuração/PostgreSQL, build e TypeScript. `test:production` exige build prévio e confirma que produção sem configuração não expõe o espaço local nem dados das APIs. Os testes SQL usam PostgreSQL local via PGlite com uma representação controlada do Auth; não substituem o teste no Supabase real.

## Base técnica

Next.js App Router, React, TypeScript, CSS próprio, Supabase Auth/Postgres/RLS e Zod. Valores financeiros são centavos inteiros. Módulos secundários carregam sob demanda. O servidor solicita um snapshot consistente ao banco; escritas usam um RPC transacional com chave de idempotência. Não há uso de chave administrativa `service_role` ou `sb_secret_...`. A integração opcional usa um papel PostgreSQL técnico restrito, com TLS verificado.

O projeto pode ser executado em uma hospedagem compatível com Next.js; não exige Vercel para desenvolvimento. Registro.br será usado para o domínio/DNS após a definição da hospedagem. Nenhum registro DNS é alterado por este código.

## Continuidade e limites

Leia [SEGURANCA_E_CONTINUIDADE.md](docs/SEGURANCA_E_CONTINUIDADE.md). A v1 carrega um snapshot com limites explícitos, apresenta paginação na interface e mostra os 1.000 eventos de histórico mais recentes. A restauração JSON é somente local e aceita até 5 MB. Não há migração automática dos registros locais para a nuvem, conexão a banco pessoal, cofre bancário, assinaturas, envio automático de mensagens, anexos ou emissão fiscal. Pagamentos de teste não criam caixa real. A integração implementada ainda não foi conectada a uma conta real nem homologada no serviço.

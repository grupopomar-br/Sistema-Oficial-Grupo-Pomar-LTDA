# Homologação da Central de Entregas

## Estado da entrega

O PR #36 reúne a implementação da metodologia de Perfil da Empresa no Google. A base anterior é `ed7041f`, que já contém o radar de projetos e o avanço informado. A migração e as novas telas aguardam homologação em um ambiente próprio antes da publicação na Central.

A implementação usa as tarefas, os clientes, os projetos, os contratos, os resultados e o histórico existentes. Os novos registros operacionais pertencem ao schema privado. A evidência é uma referência HTTPS ou um caminho identificável de um arquivo privado, conferida pelo proprietário.

## Preparação do ambiente

1. Utilize um projeto Supabase de homologação com usuário proprietário de teste e MFA, conforme `CONFIGURACAO.md`. Configure a aplicação com `POMAR_ENVIRONMENT=staging` e as variáveis desse ambiente.
2. Aplique as migrações anteriores, em ordem, até `20261117145053_acompanhamento_de_projetos.sql`. Confira especialmente a existência da personalização, dos projetos removidos e da RPC de avanço.
3. Aplique o arquivo completo `supabase/migrations/20261127111115_central_de_entregas.sql` uma vez no banco de homologação. O arquivo contém uma transação.
4. Cadastre um cliente fictício, um projeto vinculado e um contrato de teste. Confirme a autenticação com o proprietário e mantenha os perfis Google fora do piloto.
5. Abra a versão do código do PR. A aplicação identifica a nova RPC e habilita o módulo. A ausência da migração mantém a leitura anterior com a área de entregas aguardando ativação.

A leitura do banco hospedado da Central retornou ausência de permissão nesta sessão. A validação automática de banco usa PostgreSQL 17 isolado com as migrações e os papéis do projeto. Login, TOTP, cache do PostgREST e rede precisam ser verificados no serviço de homologação.

## Roteiro funcional

1. Abra um projeto existente e escolha **Entregas**, depois **Criar plano de entrega**.
2. Selecione **Perfil da Empresa no Google, versão 1**. Confira o contrato vinculado, informe a referência do escopo, o início, o encerramento inclusivo e o prazo da implantação. Confirme a conferência do escopo.
3. Verifique a criação de 26 tarefas nos oito grupos. Abra **Tarefas** e **Semana** para confirmar que os mesmos registros aparecem nas áreas comuns.
4. Na primeira entrega, informe a quantidade realizada, confirme os critérios e acrescente evidência com a data real da execução. Encaminhe para **Em validação**.
5. Abra novamente a entrega e selecione **Concluída** após conferir o material. Observe o avanço ponderado na ficha.
6. Tente validar uma entrega dependente com pré-requisitos abertos. Confira a recusa e a preservação dos registros.
7. Em uma etapa condicional fora do escopo, escolha **Não aplicável**, informe quantidade zero e justifique. Confira a mudança do denominador e a evidência da dispensa no histórico.
8. Registre uma entrega **Aguardando cliente** ou **Bloqueada**, com dependência, próxima ação e prazo de acompanhamento. Confira a fila diária.
9. Em **Recorrência**, confirme uma obrigação de duas publicações por competência durante seis meses. Verifique as seis competências, suas datas e o total de doze unidades previstas. Use um contrato com três parcelas para verificar a independência entre as programações.
10. Registre uma das duas publicações, com evidência. Confira a quantidade realizada e a pendência da validação integral. Registre a segunda, encaminhe para validação e conclua depois da conferência.
11. Recarregue a página e confira persistência, evidências e histórico.
12. Complete a implantação. O indicador deve chegar a 100% mantendo as obrigações recorrentes e o contrato disponíveis.
13. Reabra uma etapa necessária com motivo. Confira a reabertura para validação das dependências concluídas e da auditoria final. O histórico e as evidências anteriores permanecem consultáveis.
14. Reagende uma obrigação vencida com justificativa. Confira a conservação do prazo original e do atraso correspondente.
15. Pause o plano. Confira sua saída da fila diária e a consulta da ficha. Retome com justificativa.
16. Valide os mesmos fluxos no celular e exporte um backup do ambiente de teste.

## Regras para interpretar os indicadores

| Indicador                  | Base de cálculo                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Avanço informado           | Última medição manual do projeto, com o comportamento anterior para tarefas comuns       |
| Implantação validada       | Peso das entregas aplicáveis validadas sobre peso aplicável                              |
| Recorrência da competência | Obrigações integralmente validadas sobre obrigações previstas para a competência         |
| Quantidade realizada       | Unidades informadas com evidência de execução, incluindo entregas que aguardam validação |
| Unidades validadas         | Quantidade contratada das obrigações integralmente validadas                             |
| No prazo original          | Obrigações validadas até o dia do prazo original, no fuso America/Fortaleza              |

A dispensa exige justificativa e é permitida nas etapas condicionais. A conclusão exige validação, critérios completos, quantidade integral e evidência. O sistema registra a conferência feita pelo proprietário. A disponibilização pública de alterações no Google é conferida na execução da metodologia.

## Arquivos e decisões técnicas

- `src/lib/domain/delivery/` contém esquemas, a versão inicial do modelo, transições, competências, cálculo e validação de vínculos.
- `src/components/delivery/` contém a ficha, os editores, os indicadores e as ações compartilhadas com as tarefas.
- `src/components/views/deliveries.tsx` apresenta a fila operacional e seus filtros.
- A rota comum de comandos direciona as quatro operações de entrega para `pomar_delivery_command`.
- `pomar_workspace_deliveries` compõe o snapshot. A RPC anterior recebe uma projeção compatível dos estados de tarefa para permitir retorno à versão anterior da aplicação.
- As tabelas privadas usam RLS forçada, controle de proprietário e permissões explícitas. A função privada de escrita verifica a sessão, bloqueia os registros e valida a versão. O log de comandos impede duplicação e rejeita reutilização de chave com outro conteúdo.
- O modelo e os registros de evidência e histórico possuem proteção contra alteração e exclusão. Um novo modelo recebe outra versão.
- O prazo original e as regras de recorrência confirmadas permanecem fixos. A alteração de escopo e a prorrogação de um plano já programado ficam para um próximo incremento com revisão contratual própria.
- Novos modelos de site, e-commerce e sistemas podem utilizar os mesmos campos e comandos. O modelo executável entregue neste PR é o de Google.

## Testes e limites de validação

Os testes de domínio cobrem competências, ano bissexto, limite de vigência, pesos aplicáveis, escopo, preservação do avanço informado, reexecução, vínculos e backup. O teste de PostgreSQL 17 cobre as migrações, RLS, papéis, evidências, dispensa, validação, reabertura de dependências, conflito, idempotência, recorrência e preservação das entidades financeiras.

Os comandos de verificação do repositório são `npm run verify`, `npm run test:production`, `npm run format:check` e `npm run audit:production`. A conferência pelo navegador utiliza dados fictícios em armazenamento de desenvolvimento.

As evidências e os eventos têm limite de 40 mil registros no snapshot desta versão. Tarefas compartilham o limite existente de 20 mil e os planos suportam até 120 competências mensais. Esses limites são verificados e exigem paginação de leitura antes de ampliação. A aplicação gera toda a vigência confirmada em uma transação, com uma tarefa por regra e competência.

## Retorno de versão

A aplicação anterior, em `ed7041f`, pode voltar a ser publicada mantendo os dados operacionais no banco. A RPC anterior converte os estados adicionais para o formato reconhecido por essa versão. Os registros de entrega continuam protegidos contra edição pelo formulário genérico de tarefas. A atualização para o código deste PR retoma a consulta completa.

Preserve as tabelas operacionais para manter auditoria e evidências. Um contrato vinculado a um plano possui uma referência histórica protegida por chave estrangeira. Operações de remoção que rompam esse vínculo serão recusadas pelo banco.

## Aceite antes da publicação

Registre a execução do roteiro no ambiente de homologação, incluindo persistência após novo login, visualização no celular e a conferência dos indicadores. Depois do aceite do proprietário, revise o PR, aplique a migração no projeto autorizado e publique a versão aprovada.

## Resultado da verificação desta revisão

- A suíte executou 127 testes e concluiu com aprovação integral, incluindo o teste de PostgreSQL 17 e o cenário de contratante de parceria.
- Build, TypeScript, testes de rotas em produção local e formatação passaram. A auditoria de dependências de produção retornou zero vulnerabilidades.
- No navegador de desenvolvimento, um projeto existente recebeu o plano, a primeira entrega foi validada com evidência e a implantação passou para 5%. Foram geradas seis competências com duas publicações cada. A recarga preservou os registros.
- A fila em largura de celular exibiu conteúdo de 375 pixels e largura de documento de 375 pixels. O formulário de entrega teve conteúdo e rolagem interna de 326 pixels, e a ficha do plano apresentou 374 pixels em ambas as medidas. Foi registrada uma espera pelo cliente pelo formulário móvel.
- A consulta ao projeto Supabase hospedado retornou ausência de permissão. O teste com autenticação real, PostgREST e uma base exclusiva de homologação permanece no roteiro de aceite.

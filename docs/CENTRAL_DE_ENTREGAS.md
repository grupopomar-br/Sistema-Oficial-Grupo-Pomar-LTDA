# Central de Entregas — especificação operacional v1

> Referência inicial registrada em 26/11/2026 e implementação de homologação iniciada em 27/11/2026. Este PR reúne a arquitetura, o núcleo, a persistência, a interface e os testes da Central de Entregas.

## Objetivo e diagnóstico

Transformar compromissos vendidos em uma fila rastreável de entregas, sem depender da memória ou da disposição do proprietário. Um perfil pode ser otimizado em um ou dois dias, mas um contrato pode durar três, seis ou doze meses: **implantação concluída não significa contrato concluído**.

A Central Operacional já possui clientes, projetos, tarefas, contratos, metodologias, atualizações e histórico. Não recriar esses módulos. Adicionar **planos de entrega versionados** aos projetos existentes.

## Estados e separação de responsabilidades

- **Implantação**: onboarding, diagnóstico, execução técnica, auditoria e aceite.
- **Recorrência**: entregas periódicas previstas no contrato, registradas por competência.
- **Resultados**: métricas observadas, separadas do percentual de conclusão do checklist.
- **Contrato**: duração, escopo, vigência, exclusões e promessas; não é concluído automaticamente após a implantação.

Cada atividade precisa de responsável, prazo, estado, próxima ação, dependência, evidência e data de validação. Estados de execução disponíveis na tarefa comum são a fazer, em execução, aguardando cliente, bloqueada, em validação, concluída e não aplicável. Uma etapa obrigatória não pode ser dispensada; uma etapa condicional só recebe “não aplicável” com justificativa.

### Indicadores distintos

1. **Avanço de implantação** usa a soma dos pesos das entregas aplicáveis validadas sobre a soma dos pesos aplicáveis. Os pesos de 2 a 5 refletem resultados verificáveis e são fixados na versão do modelo.
2. **Execução recorrente** = obrigações do período realizadas / obrigações do período contratado.
3. **Pontualidade contratual** informa quantas obrigações foram validadas até o prazo original, usando o instante de validação no fuso da operação.
4. **Resultados de marketing**: chamadas, cliques, solicitações de rota e demais dados disponíveis, com fonte e janela de datas. Não tratar tráfego como conversão comprovada.
5. O avanço manual do projeto já implementado deve permanecer visível e independente.

Não permitir 100% de implantação com bloqueios, pendências, evidências ausentes ou condicionais não avaliadas.

## Método 1 — Perfil da Empresa no Google

| Fase             | Entregas verificáveis                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| Onboarding       | Contrato/escopo, autorização, propriedade e acessos, formulário confirmado          |
| Diagnóstico      | Marco zero, concorrentes relevantes, pesquisas por serviço e localização, riscos    |
| Identidade       | Nome real, categorias, endereço/pino, área atendida, horários legítimos             |
| Conteúdo         | Descrição, serviços confirmados, atributos válidos, telefone/site/WhatsApp testados |
| Mídias           | Fotos/vídeos originais e publicações **somente se contratados e autorizados**       |
| Reputação        | Avaliações legítimas e respostas conforme escopo; sem incentivos por nota           |
| Presença externa | Diretórios reais e úteis **se aplicáveis**; dados consistentes                      |
| Integração       | Site e SEO local quando existir site, com validação de NAP e indexação              |
| Qualidade        | Conferência posterior no Google, evidências, pendências de verificação e relatório  |

**Riscos críticos**: alterações em nome, categoria principal, endereço/pino, horário ou identidade do negócio só após confirmação e aprovação registrada. Nunca marcar como executado algo apenas solicitado ou aceito por uma API sem conferência posterior.

**Diretórios** são uma opção avaliada por relevância, não meta universal. Não cadastrar em listas artificiais. Não prometer que geotags, postagens ou repetição de palavras-chave garantam ranking.

### Recorrência de Perfil da Empresa

Revisar dados e sugestões de edição; publicar conteúdos na quantidade contratada; acompanhar mídias, avaliações e interações; elaborar relatório de período. Alterações de telefone ou horários por demanda viram tarefas eventuais, **não cobranças automáticas**. Cada competência permanece independente da implantação inicial.

## Método 2 — Site profissional

Briefing, escopo, domínio e titularidade, backup e redirecionamentos, arquitetura de páginas, conteúdo, mobile-first, formulários e WhatsApp, SEO técnico, SEO local quando aplicável, Search Console, performance, acessibilidade, segurança, testes de ponta a ponta, aceite e manutenção contratada.

## Método 3 — E-commerce

Definir primeiro a jornada real do projeto: alguns usam carrinho → WhatsApp, **sem checkout tradicional**. Validar catálogo, integrações com ERP, fonte da verdade, disponibilidade e preço, fotos reais, pesquisa, carrinho, proteção de dados internos, RLS/autorização, logs, SEO, experiência mobile, homologação, contingência e rollback. Recorrência conforme manutenção contratada.

## Dados a integrar incrementalmente

- `pomar_private.service_playbooks` fixa a versão do modelo e seus critérios.
- `pomar_private.delivery_plans` registra projeto, contrato, documento de metodologia, escopo e vigência.
- `public.pomar_tasks` mantém o estado, o prazo e o foco da tarefa de execução.
- `pomar_private.delivery_items` acrescenta critérios, peso, fase, dependências e quantidades à mesma tarefa. A fase recorrente inclui a competência.
- `pomar_private.delivery_evidence` preserva referências e datas de execução.
- `pomar_private.delivery_events` preserva o histórico detalhado de cada alteração.

**Nunca duplicar clientes, contratos ou recebimentos**. Números financeiros são preservados. Projeto e contrato podem ser encerrados independentemente da conclusão da implantação.

## Motor de recorrência

- Gerar competências de 3, 6 ou 12 meses (ou quantidade efetivamente contratada), ancoradas na data inicial, inclusive viradas de mês.
- Obrigação recorrente só existe se prevista no escopo. Uma rotina repetida não gera tarefas duplicadas.
- Prazo, histórico e atraso não desaparecem ao adiar uma entrega.
- Não gerar novas obrigações depois do fim do contrato; preservar histórico anterior.
- Tarefas condicionais podem ser dispensadas apenas com justificativa auditável.

## Experiência na interface

No projeto: abas **Implantação**, **Recorrência**, **Resultados**, **Evidências** e **Histórico**. Cada item exibe caixa de conclusão, situação, prazo, critério de aceite e evidência. Indicador verde **apenas após gravação e conferência no banco**.

Na visão diária: vencidas, vencendo, bloqueadas, aguardando cliente e próximas ações. Priorizar por prazo e risco contratual, não por preferência do operador.

## Segurança e cronograma de implementação

1. Auditoria do domínio, Auth/RLS e comandos atuais; identificar pontos de integração sem alterar o financeiro.
2. Criar domínio de modelos versionados e testes de cálculo/recorrência.
3. Migração incremental de tabelas protegidas com RLS forçada, regras de proprietário, constraints e idempotência; nunca migrar produção sem homologação.
4. Conectar comandos transacionais e snapshot; manter compatibilidade com dados existentes.
5. Implementar UI mobile-first; testar estados, filtros, evidências e recuperação de falhas.
6. Pilotar com dados fictícios. Validar com um projeto real **somente em ambiente autorizado**.
7. Executar testes, auditoria de segurança e revisão antes de merge/deploy.

**Restrições**: sem `service_role` no frontend; sem acesso público ao workspace; sem credenciais, backups ou informações reais de clientes no Git; sem alterações em Pix, webhook, conciliação ou checkout.

## Aceite

Um projeto com implantação 100% continua mostrando suas obrigações recorrentes. Etapas sem evidência não avançam. Dependências externas aparecem claramente. Tarefas repetidas não duplicam. Não há mudança no caixa nem ação externa automática. Acesso só para o proprietário autorizado.

## Fontes oficiais

- Google, classificação local: https://support.google.com/business/answer/7091
- Google, diretrizes: https://support.google.com/business/answer/3038177
- Google, serviços: https://support.google.com/business/answer/9455399
- LocalBusiness: https://developers.google.com/search/docs/appearance/structured-data/local-business
- Supabase, RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

## Auditoria do código em 27/11/2026

A base de desenvolvimento parte de `ed7041f` e incorpora o documento do PR #36, `dfbfd1c`. As branches remotas e os PRs abertos foram conferidos antes das alterações. Os demais PRs são de dependências, e a única proposta de entregas é este PR em rascunho.

- `model.ts` valida comandos e snapshots com Zod. `workspace.ts` executa o modo local e valida vínculos. `transport.ts` converte os campos para SQL.
- `pomar_tasks` já é a lista comum à ficha, Tarefas, Semana e foco diário. O módulo utiliza essas mesmas linhas e acrescenta metadados de entrega em schema privado.
- As metodologias atuais são documentos editáveis. Um plano registra a referência opcional a esse documento e fixa uma versão imutável do modelo executável. Revisar um modelo futuro preserva os planos já criados.
- O avanço existente é calculado por tarefas comuns até haver uma medição manual. As tarefas de entrega terão indicadores próprios e serão excluídas desse cálculo de referência.
- Os contratos atuais registram eventos financeiros e o escopo em notas. A vigência operacional e as quantidades serão confirmadas na criação do plano e da recorrência, com referência ao contrato existente.
- A leitura usa RPCs incrementais com recuo apenas em `PGRST202`. A nova RPC compõe o snapshot anterior, e a aplicação sinaliza a disponibilidade do módulo.

### Decisões de implementação

O estado de execução permanece na tarefa. Os estados adicionais de espera pelo cliente, validação e dispensa são incorporados a `pomar_tasks`. Metadados contêm critérios, peso, dependências, competência, quantidades e aceite. Uma proteção no banco direciona a alteração de tarefas vinculadas para o comando de entregas, que valida critérios e grava histórico na mesma transação. O planejamento de foco continua disponível.

A implantação usa pesos definidos por resultado verificável. Itens dispensáveis saem do denominador depois de justificativa registrada. Itens obrigatórios permanecem no cálculo. A conclusão exige critérios confirmados, evidência, conferência em validação e dependências cumpridas. A última auditoria exige todas as demais etapas aplicáveis concluídas.

Cada competência começa na data de aniversário mensal do início contratado. O encerramento é inclusivo e o último período é limitado à vigência. Quantidades, critérios e periodicidade são explicitamente confirmados pelo proprietário. Uma obrigação corresponde a uma tarefa por regra e competência, com índice único no banco. O calendário semanal existente recebe seus prazos.

A quantidade realizada pode ser registrada progressivamente com novas evidências. O indicador de cumprimento considera as obrigações integralmente validadas. O prazo original permanece no histórico e orienta atraso e pontualidade após um reagendamento.

As novas tabelas terão RLS forçada e leitura exclusiva do proprietário. A escrita ocorre por funções privadas de escopo restrito, com invocador público, validação de proprietário/sessão, bloqueio de linha, versão esperada e chave idempotente. As funções financeiras e os fluxos de pagamento permanecem fora desta implementação.

### Homologação prevista

Testes de domínio, transições, datas de aniversário e dispensa; migrações completas em PostgreSQL 17 de teste; isolamento entre usuários e workers; bloqueio de escrita direta; repetição e conflito; compatibilidade de snapshots e regressão do sistema. A interface será exercitada com dados fictícios em desktop e celular. O PR continuará aguardando homologação para produção.

### Critérios e progressão das tarefas

O modelo inicial contém 26 entregas em oito grupos. Os pesos são critérios operacionais do Grupo Pomar e podem ser revisados em uma próxima versão. O modelo é registrado pelo SQL e a interface usa sua versão persistida. Uma edição do documento de metodologia associado mantém a versão executável do plano.

O registro de uma nova quantidade realizada exige uma nova evidência e a data da execução. A conclusão usa duas gravações distintas, encaminhamento para validação e confirmação após a conferência. O proprietário confirma os critérios e a evidência. Referências privadas são aceitas para manter arquivos sob o controle da empresa. A comprovação se dá pela conferência humana registrada.

A fila prioriza prazo original, dependências liberadas e sequência metodológica. O acompanhamento considera os eventos operacionais para avaliar a atividade recente do projeto. O percentual e o contador manuais continuam associados às atualizações de projeto.

### Revisão da metodologia Google

As fontes oficiais foram consultadas em 27/11/2026. Os critérios exigem identificação comercial verdadeira, categorias compatíveis, autorização de acesso, informações precisas, mídias e publicações conferidas após processamento. O fluxo de reputação exige experiências autênticas e solicitação sem incentivos ou seleção por nota. A metodologia registra contexto e período ao comparar desempenho. Relevância, distância e destaque orientam o diagnóstico.

Os recursos de produtos, WhatsApp, atributos e agendamento são conferidos conforme a disponibilidade do perfil e o escopo. A verificação inicial e as alterações sensíveis exigem a confirmação do responsável. O modelo mantém atividades condicionais que podem receber dispensa justificada.

O vínculo contratual admite tanto o cliente atendido quanto o contratante de parceria registrado no projeto. O cliente da operação mantém seu cadastro e seus resultados próprios.

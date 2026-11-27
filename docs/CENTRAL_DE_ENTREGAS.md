# Central de Entregas — especificação operacional v1

> Proposta técnica registrada em 26/11/2026 com base nos dois áudios transcritos. Esta entrega é documental: **não** aplica migrações, não altera produção, não publica em perfis Google e não mexe no financeiro.

## Objetivo e diagnóstico

Transformar compromissos vendidos em uma fila rastreável de entregas, sem depender da memória ou da disposição do proprietário. Um perfil pode ser otimizado em um ou dois dias, mas um contrato pode durar três, seis ou doze meses: **implantação concluída não significa contrato concluído**.

A Central Operacional já possui clientes, projetos, tarefas, contratos, metodologias, atualizações e histórico. Não recriar esses módulos. Adicionar **planos de entrega versionados** aos projetos existentes.

## Estados e separação de responsabilidades

- **Implantação**: onboarding, diagnóstico, execução técnica, auditoria e aceite.
- **Recorrência**: entregas periódicas previstas no contrato, registradas por competência.
- **Resultados**: métricas observadas, separadas do percentual de conclusão do checklist.
- **Contrato**: duração, escopo, vigência, exclusões e promessas; não é concluído automaticamente após a implantação.

Cada atividade precisa de responsável, prazo, estado, próxima ação, dependência, evidência e data de validação. Estados: a fazer, em andamento, bloqueada, concluída ou não aplicável. Uma etapa obrigatória não pode ser dispensada; uma etapa condicional só recebe “não aplicável” com justificativa.

### Indicadores distintos

1. **Avanço de implantação** = etapas aplicáveis concluídas **com evidência** / etapas aplicáveis.
2. **Execução recorrente** = obrigações do período realizadas / obrigações do período contratado.
3. **Pontualidade contratual** = obrigações concluídas até o prazo / obrigações com prazo vencido no período.
4. **Resultados de marketing**: chamadas, cliques, solicitações de rota e demais dados disponíveis, com fonte e janela de datas. Não tratar tráfego como conversão comprovada.
5. O avanço manual do projeto já implementado deve permanecer visível e independente.

Não permitir 100% de implantação com bloqueios, pendências, evidências ausentes ou condicionais não avaliadas.

## Método 1 — Perfil da Empresa no Google

| Fase | Entregas verificáveis |
|---|---|
| Onboarding | Contrato/escopo, autorização, propriedade e acessos, formulário confirmado |
| Diagnóstico | Marco zero, concorrentes relevantes, pesquisas por serviço e localização, riscos |
| Identidade | Nome real, categorias, endereço/pino, área atendida, horários legítimos |
| Conteúdo | Descrição, serviços confirmados, atributos válidos, telefone/site/WhatsApp testados |
| Mídias | Fotos/vídeos originais e publicações **somente se contratados e autorizados** |
| Reputação | Avaliações legítimas e respostas conforme escopo; sem incentivos por nota |
| Presença externa | Diretórios reais e úteis **se aplicáveis**; dados consistentes |
| Integração | Site e SEO local quando existir site, com validação de NAP e indexação |
| Qualidade | Conferência posterior no Google, evidências, pendências de verificação e relatório |

**Riscos críticos**: alterações em nome, categoria principal, endereço/pino, horário ou identidade do negócio só após confirmação e aprovação registrada. Nunca marcar como executado algo apenas solicitado ou aceito por uma API sem conferência posterior.

**Diretórios** são uma opção avaliada por relevância, não meta universal. Não cadastrar em listas artificiais. Não prometer que geotags, postagens ou repetição de palavras-chave garantam ranking.

### Recorrência de Perfil da Empresa

Revisar dados e sugestões de edição; publicar conteúdos na quantidade contratada; acompanhar mídias, avaliações e interações; elaborar relatório de período. Alterações de telefone ou horários por demanda viram tarefas eventuais, **não cobranças automáticas**. Cada competência permanece independente da implantação inicial.

## Método 2 — Site profissional

Briefing, escopo, domínio e titularidade, backup e redirecionamentos, arquitetura de páginas, conteúdo, mobile-first, formulários e WhatsApp, SEO técnico, SEO local quando aplicável, Search Console, performance, acessibilidade, segurança, testes de ponta a ponta, aceite e manutenção contratada.

## Método 3 — E-commerce

Definir primeiro a jornada real do projeto: alguns usam carrinho → WhatsApp, **sem checkout tradicional**. Validar catálogo, integrações com ERP, fonte da verdade, disponibilidade e preço, fotos reais, pesquisa, carrinho, proteção de dados internos, RLS/autorização, logs, SEO, experiência mobile, homologação, contingência e rollback. Recorrência conforme manutenção contratada.

## Dados a integrar incrementalmente

- `service_playbook`: família, versão imutável e etapas/obrigação padrão.
- `project_delivery_plan`: referência ao projeto/contrato, escopo, versão, início, fim e situação.
- `project_delivery_step`: etapa, prazo, estado, evidência, aprovação, bloqueio e justificativa.
- `project_recurring_obligation`: tarefa, competência, vencimento, quantidade contratada, estado e evidência.
- `delivery_audit_event`: evento imutável com ator, momento, operação e justificativa.

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

# Resultados do Perfil da Empresa no Google

A aba **Resultados** organiza a performance informada pelo proprietário para cada cliente e perfil/unidade. O preenchimento é manual: não conecta contas Google, não coleta dados automaticamente e não publica relatórios para clientes.

## Registrar e conferir

1. Cadastre o cliente em Clientes.
2. Abra a performance do perfil no Google e selecione o período.
3. Na Central, escolha o cliente e **Registrar período**. Mantenha o mesmo nome do perfil/unidade nos próximos registros.
4. Informe as datas inicial e final e a data em que conferiu os dados.
5. Copie os seis totais disponíveis: interações, chamadas, agendamentos, solicitações de rotas, cliques no site e pessoas que visualizaram o perfil. Deixe em branco a métrica que o Google não informar; zero só quando o relatório mostrar zero.
6. Acrescente contexto e marque a conferência. Sem essa marca, o registro fica como rascunho.

O total de interações é transcrito diretamente, sem tentar reconstruí-lo pela soma das outras métricas. Visualizações de pessoas também são transcritas para o período escolhido, sem somar dias, plataformas ou relatórios. Chamadas representam cliques no botão; não comprovam atendimento. Agendamentos dependem da disponibilidade dessa métrica no Google.

## Comparar com fidelidade

A comparação usa registros conferidos do mesmo cliente e perfil, sem sobreposição de datas. A sugestão prioriza duração igual e depois o período anterior mais recente. É possível escolher outra base anterior. Períodos com durações diferentes recebem uma observação visível.

- Variação: `(atual − anterior) / anterior × 100`, arredondada apenas na apresentação para uma casa decimal.
- Base anterior igual a zero com valor atual positivo: mostra diferença absoluta e **Sem base percentual**, sem fabricar 100% ou infinito.
- Ambos iguais a zero: 0%. Dado ausente em qualquer lado: sem percentual.
- Barras comparam os dois números; não representam uma meta nem uma nota de qualidade.
- Os números não são somados entre perfis ou períodos e não comprovam faturamento ou causalidade de uma ação específica.

O histórico permite editar, arquivar e restaurar. Edições concorrentes são recusadas; um período repetido do mesmo perfil deve ser editado. O CSV exporta os registros selecionados sem alterar os números e identifica métricas não informadas. Backups da Central incluem os resultados.

## Instalação

Aplicar manualmente, uma vez, [resultados_google_e_avisos_personalizados](../supabase/migrations/20261103041048_resultados_google_e_avisos_personalizados.sql), depois da migração de reuniões/notificações. O novo RPC de snapshot tem compatibilidade com a versão anterior enquanto a instalação estiver pendente. Falhas de acesso, rede ou banco não são convertidas em dados vazios.

Tabela com RLS forçado, acesso do proprietário com sessão/MFA, vínculo de cliente por proprietário, auditoria, idempotência e controle de versão. Nenhum registro real é criado pelo código ou pelos testes.

Referência: [métricas oficiais do Google](https://support.google.com/business/answer/9918094?hl=pt-BR).

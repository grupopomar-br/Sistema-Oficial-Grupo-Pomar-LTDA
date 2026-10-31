# Guia de uso da primeira versão

## Organizar a operação

Comece pelos clientes e pelas áreas em Preferências. Uma área representa uma frente do trabalho, sem confundir prioridade com faturamento. Crie o projeto, vincule cliente e contratante quando forem diferentes, informe o prazo e descreva a próxima ação concreta. Em projetos aguardando terceiros, registre o que falta e quando acompanhar.

Divida a execução em tarefas. P0 é um incidente crítico; P1, alta prioridade; P2, trabalho normal; P3, evolução futura. A gravidade dos alertas é calculada separadamente a partir dos compromissos. Concluir uma tarefa atualiza o progresso e remove o alerta de atraso; é possível reabri-la.

A visão geral apresenta até cinco ações, conforme a preferência escolhida. Ela considera tarefas reservadas para o dia, vencimentos, prioridade, cobranças e acompanhamentos. Os números da navegação e da Central de Atenção vêm da mesma regra de alertas. Projetos concluídos e cancelados saem das próximas ações.

## Preservar contexto

Abra o projeto para registrar uma atualização, decisão ou entrega. O texto completo é preservado em Atualizações, enquanto o histórico mostra um resumo. Atualizações registradas pelo fluxo da aplicação renovam a atividade do projeto. A busca do cabeçalho encontra projetos, clientes, contatos e tarefas; o atalho é Ctrl/⌘ + K.

## Acompanhar oportunidades

Cadastre a oportunidade ligada a um cliente, informe a etapa e a próxima data de contato. O valor é uma estimativa comercial. Converter em projeto aproveita o cliente e o contexto, marca a oportunidade como ganha e cria o projeto uma vez. Contrato e recebimento continuam sendo registrados separadamente.

## Controlar o financeiro

- **Contrato:** compromisso fechado com valor e data. O total é distribuído em parcelas; diferenças de centavos são ajustadas sem alterar a soma. Os vencimentos mensais preservam o dia original quando existe no mês.
- **Parcela:** previsão de vencimento. Recebimentos parciais diminuem seu saldo. O sistema recusa receber acima do saldo.
- **Recebimento:** valor que efetivamente entrou. O caixa mensal usa sua data real, não a data do contrato.
- **Recebimento antigo sem data:** fica no total a conciliar e fora do caixa mensal. Conciliar informa a data do mesmo recebimento; não cria uma segunda entrada.
- **Estorno:** preserva o lançamento original, registra o motivo e devolve o saldo da parcela.
- **Cancelamento do contrato:** preserva recebimentos existentes e retira parcelas canceladas do saldo a receber. Não gera devolução bancária nem estorna automaticamente o que entrou.
- **Despesa:** só entra no caixa realizado quando estiver paga e tiver data de pagamento. Despesas previstas e canceladas são tratadas separadamente.

Os gráficos mostram os valores calculados dos registros. Um mês vazio é zero. O botão do olho oculta valores na interface; exportações continuam contendo os valores completos. O CSV exporta recebimentos e despesas, incluindo estados, para conferência. Não é conciliação automática de banco nem relatório fiscal.

## Cuidar da continuidade

No desenvolvimento local, os registros ficam apenas no navegador e no dispositivo usados. Exporte JSON em Preferências e guarde a cópia em local privado. A restauração local valida estrutura, valores e vínculos e exige confirmação antes de substituir o espaço atual. O limite de importação é 5 MB.

Na nuvem, o JSON exportado contém o snapshot operacional carregado e os 1.000 eventos de histórico mais recentes. Não substitui o backup completo do banco, das configurações do Auth e das contas administrativas. A restauração em nuvem e a migração do espaço local são procedimentos futuros, sem importação automática nesta versão.

## Cobrança com previsibilidade

Abra Cobranças para ver saldo por parcela, vencimentos, faixas de atraso e promessas de pagamento. Em Condições, registre o valor de entrada, a regra de início/entrega e a referência do aceite. Enquanto não houver aceite confirmado, a regra é uma proposta. Uma condição aceita de entrada protege a transição para execução; quitação combinada protege a conclusão do projeto.

Prepare a mensagem, confira e copie para o canal combinado. O sistema não envia por você. Registre o contato realizado e a nova previsão informada. O histórico preserva esses registros; recebimento reduz o saldo e remove a parcela quitada da fila.

Na conexão da nuvem, o checkout só aparece habilitado com configuração técnica conferida. A validade do link é real. Uma dúvida de criação precisa ser conferida antes de repetir. Um pagamento divergente aparece em revisão; a confirmação sempre consulta o provedor. Simulações não quitam parcelas reais nem entram no saldo gerencial.

## Ideias sem depender da memória

Use a lâmpada do cabeçalho para capturar uma ideia rapidamente. Descreva contexto e resultado esperado, escolha a área e deixe na caixa de entrada. No módulo Ideias, revise prioridades e transforme em tarefa quando decidir executar. A conversão reaproveita o conteúdo e não cria tarefas repetidas para a mesma ideia. No celular, o acesso fica também na navegação inferior.

## Sessão e valores sensíveis

Na nuvem, a sessão tem bloqueio por inatividade e tempo máximo de duração. Ao gerar checkout ou conferir um pagamento, pode ser necessário confirmar novamente o autenticador. Esse comportamento protege operações sensíveis, sem depender apenas do botão de ocultar valores.

O indicador financeiro é gerencial e bruto; não equivale ao saldo de um banco ou à disponibilidade para saque. O armazenamento específico de dados bancários de maior risco exige a etapa de cofre/criptografia e homologação indicada no roadmap.

import { servicePlaybookSchema, type ServicePlaybook } from "./schema.ts";

const groups = {
  onboarding: "Onboarding",
  diagnosis: "Diagnóstico",
  information: "Informações empresariais",
  content: "Serviços e conteúdo",
  media: "Mídias",
  reputation: "Reputação",
  presence: "Presença local",
  quality: "Auditoria e entrega",
};
function step(
  groupKey: keyof typeof groups,
  key: string,
  title: string,
  criteria: string[],
  options: {
    required?: boolean;
    critical?: boolean;
    weight?: number;
    dependsOn?: string[];
    finalReview?: boolean;
  } = {},
) {
  return {
    key,
    groupKey,
    groupTitle: groups[groupKey],
    title,
    criteria,
    required: options.required ?? true,
    critical: options.critical ?? false,
    weight: options.weight ?? 2,
    dependsOn: options.dependsOn ?? ["scope", "authorization"],
    finalReview: options.finalReview ?? false,
  };
}

export const googleBusinessPlaybook: ServicePlaybook =
  servicePlaybookSchema.parse({
    key: "google-business-profile",
    version: 1,
    title: "Perfil da Empresa no Google",
    family: "google",
    reviewedOn: "2026-11-27",
    sources: [
      "https://support.google.com/business/answer/3038177?hl=pt-BR",
      "https://support.google.com/business/answer/7091?hl=pt-BR",
      "https://support.google.com/business/answer/9455399?hl=pt-BR",
      "https://support.google.com/business/answer/6103862?hl=pt-BR",
      "https://support.google.com/contributionpolicy/answer/7400114?hl=pt-BR",
      "https://support.google.com/business/answer/7342169?hl=pt-BR",
    ],
    steps: [
      step(
        "onboarding",
        "scope",
        "Confirmar contrato, escopo e exclusões",
        [
          "Referência do contrato e entregas prometidas conferidas com o cliente.",
          "Limites da implantação, recorrência e responsabilidades registrados.",
        ],
        { critical: true, weight: 4, dependsOn: [] },
      ),
      step(
        "onboarding",
        "authorization",
        "Conferir autorização e acesso ao perfil",
        [
          "Responsável autorizou a gestão e mantém a titularidade do perfil.",
          "Acesso por usuário autorizado testado e situação de verificação registrada.",
        ],
        { critical: true, weight: 4, dependsOn: ["scope"] },
      ),
      step(
        "onboarding",
        "briefing",
        "Validar informações e pendências do cliente",
        [
          "Dados recebidos foram conferidos com uma fonte do negócio.",
          "Materiais e informações pendentes possuem responsável e próxima ação.",
        ],
      ),
      step(
        "diagnosis",
        "audit",
        "Auditar elegibilidade e informações do perfil",
        [
          "Duplicidade, elegibilidade, sugestões de edição e riscos avaliados.",
          "Problemas encontrados e correções propostas documentados.",
        ],
        { critical: true, weight: 4 },
      ),
      step(
        "diagnosis",
        "market",
        "Mapear demanda e concorrência local",
        [
          "Serviços reais, área atendida e pesquisas relevantes registrados.",
          "Concorrentes locais observados com data e contexto da busca.",
        ],
        { weight: 3 },
      ),
      step(
        "diagnosis",
        "baseline",
        "Registrar o marco zero",
        [
          "Situação inicial e métricas disponíveis registradas com período e fonte.",
          "Ausências de dados foram identificadas para comparação futura.",
        ],
        { weight: 3 },
      ),
      step(
        "information",
        "identity",
        "Validar o nome real da empresa",
        [
          "Nome corresponde à identidade usada pelo negócio no mundo real.",
          "Qualquer mudança foi autorizada e conferida após o processamento.",
        ],
        {
          critical: true,
          weight: 4,
          dependsOn: ["scope", "authorization", "briefing", "audit"],
        },
      ),
      step(
        "information",
        "categories",
        "Conferir categorias principal e adicionais",
        [
          "Categorias disponíveis representam as atividades efetivamente prestadas.",
          "Categoria principal e eventuais alterações aprovadas e conferidas.",
        ],
        { critical: true, weight: 4 },
      ),
      step(
        "information",
        "location",
        "Conferir endereço, pino e área atendida",
        [
          "Endereço ou cobertura corresponde ao funcionamento real e à elegibilidade.",
          "Visibilidade do endereço e localização foram conferidas com o responsável.",
        ],
        { critical: true, weight: 4 },
      ),
      step(
        "information",
        "hours",
        "Validar funcionamento e horários especiais",
        [
          "Horários foram confirmados e condizem com o atendimento real.",
          "Exceções, feriados e atendimento por agendamento avaliados.",
        ],
        { critical: true, weight: 3 },
      ),
      step(
        "information",
        "contact",
        "Testar os canais de contato disponíveis",
        [
          "Telefone e canais habilitados direcionam ao negócio correto.",
          "Site, WhatsApp ou agendamento foram testados quando disponíveis e contratados.",
        ],
        { critical: true, weight: 3 },
      ),
      step(
        "information",
        "description",
        "Revisar a descrição empresarial",
        [
          "Texto descreve serviços e diferenciais verdadeiros de forma natural.",
          "Conteúdo foi revisado conforme as diretrizes do campo e conferido no perfil.",
        ],
        { weight: 3 },
      ),
      step(
        "information",
        "attributes",
        "Revisar os atributos aplicáveis",
        [
          "Atributos disponíveis foram avaliados com o cliente.",
          "Somente características confirmadas do negócio foram informadas.",
        ],
        { required: false },
      ),
      step(
        "content",
        "services",
        "Organizar serviços efetivamente prestados",
        [
          "Lista confirmada pelo negócio e organizada nas categorias disponíveis.",
          "Descrições úteis, naturais e conferidas após a publicação.",
        ],
        { required: false, weight: 3 },
      ),
      step(
        "content",
        "products",
        "Organizar produtos quando previstos",
        [
          "Recurso disponível para o perfil e incluído no escopo contratado.",
          "Produtos e informações reais aprovados e conferidos publicamente.",
        ],
        { required: false },
      ),
      step(
        "content",
        "posts",
        "Definir e executar o conteúdo inicial contratado",
        [
          "Tema e quantidade conferidos no escopo e autorizados.",
          "Publicações e destinos do botão foram revisados e estão visíveis.",
        ],
        { required: false, weight: 3 },
      ),
      step(
        "media",
        "assets",
        "Organizar logotipo e mídias reais",
        [
          "Material autorizado, identificado e adequado aos requisitos de publicação.",
          "Pendências de imagens e vídeos registradas com o responsável.",
        ],
        { required: false },
      ),
      step(
        "media",
        "media_publish",
        "Conferir as mídias publicadas",
        [
          "Quantidade prevista e autoria dos arquivos conferidas.",
          "Arquivos aparecem no perfil após a revisão do Google.",
        ],
        { required: false, weight: 3 },
      ),
      step("reputation", "reviews_audit", "Auditar avaliações e respostas", [
        "Avaliações existentes e necessidade de resposta avaliadas.",
        "Riscos e comentários que precisam de encaminhamento documentados.",
      ]),
      step(
        "reputation",
        "reviews_reply",
        "Responder às avaliações previstas no escopo",
        [
          "Respostas individualizadas preservam privacidade e informações confirmadas.",
          "Respostas publicadas foram conferidas no perfil.",
        ],
        { required: false, weight: 3 },
      ),
      step(
        "reputation",
        "reviews_process",
        "Estruturar a solicitação legítima de avaliações",
        [
          "Fluxo solicita experiências autênticas sem recompensa ou seleção por nota.",
          "Link e orientação foram testados e entregues ao responsável.",
        ],
        { required: false },
      ),
      step(
        "presence",
        "consistency",
        "Conferir a consistência das informações locais",
        [
          "Nome, contato, endereço ou cobertura foram comparados nas fontes relevantes.",
          "Divergências foram corrigidas ou registradas como pendência.",
        ],
        { weight: 3 },
      ),
      step(
        "presence",
        "directories",
        "Avaliar e ajustar diretórios relevantes",
        [
          "Cada diretório escolhido tem utilidade real para o negócio e consta do escopo.",
          "Informações e publicação foram conferidas sem cadastros artificiais em massa.",
        ],
        { required: false },
      ),
      step(
        "presence",
        "website",
        "Conferir a integração com site e SEO local",
        [
          "Site existente e trabalho contratado foram confirmados.",
          "Contato, conteúdo local e links pertinentes foram testados no site.",
        ],
        { required: false, weight: 3 },
      ),
      step(
        "quality",
        "public_check",
        "Auditar a versão pública do perfil",
        [
          "Informações, contatos, conteúdos e mídias conferidos na Pesquisa e no Maps.",
          "Alterações em processamento e pendências do Google estão identificadas.",
        ],
        { critical: true, weight: 4 },
      ),
      step(
        "quality",
        "handover",
        "Validar a implantação e entregar o relatório",
        [
          "Todas as entregas aplicáveis foram conferidas e possuem evidência.",
          "Relatório entregue com mudanças, pendências externas e próximos compromissos.",
        ],
        { critical: true, weight: 5, finalReview: true },
      ),
    ],
  });

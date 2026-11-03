import { z } from "zod";
import { isDateOnly } from "./dates.ts";

export const googleMetrics = [
  {
    key: "interactions",
    label: "Interações",
    description: "Interações no Perfil da Empresa",
    hint: "Copie o total de interações exibido pelo Google. Não some as outras métricas para tentar reproduzi-lo.",
  },
  {
    key: "calls",
    label: "Chamadas",
    description: "Chamadas feitas do seu Perfil da Empresa",
    hint: "Cliques no botão de chamada do perfil; não confirma que a ligação foi atendida.",
  },
  {
    key: "bookings",
    label: "Agendamentos",
    description: "Agendamentos feitos no seu Perfil da Empresa",
    hint: "Agendamentos concluídos informados pelo Google. Esta métrica depende de um provedor de agendamentos compatível.",
  },
  {
    key: "directions",
    label: "Solicitações de rotas",
    description: "Solicitações de rotas feitas no seu Perfil da Empresa",
    hint: "Copie as solicitações de rotas informadas no relatório do período.",
  },
  {
    key: "websiteClicks",
    label: "Cliques no site",
    description: "Cliques para acessar o site no seu Perfil da Empresa",
    hint: "Cliques no link do site pelo perfil; não equivale a vendas.",
  },
  {
    key: "profileViews",
    label: "Pessoas que visualizaram",
    description: "Número de pessoas que visualizaram o Perfil da Empresa",
    hint: "Use o total exibido pelo Google. Não some pessoas de dias ou plataformas diferentes para estimar esse número.",
  },
] as const;
export type GoogleMetricKey = (typeof googleMetrics)[number]["key"];
const count = z.number().int().min(0).max(1_000_000_000).nullable();
const day = z
  .string()
  .refine(
    (value) => isDateOnly(value) && value >= "1900-01-01",
    "Informe uma data válida a partir de 1900.",
  );
export const googleResultSchema = z
  .strictObject({
    id: z.uuid(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    clientId: z.uuid(),
    profileName: z
      .string()
      .trim()
      .min(2, "Identifique o perfil ou a unidade.")
      .max(160),
    profileUrl: z.union([
      z.literal(""),
      z
        .url()
        .max(2048)
        .refine((s) => {
          const u = new URL(s);
          return u.protocol === "https:" && !u.username && !u.password;
        }, "Use um link HTTPS válido."),
    ]),
    periodStart: day,
    periodEnd: day,
    collectedOn: day,
    interactions: count,
    calls: count,
    bookings: count,
    directions: count,
    websiteClicks: count,
    profileViews: count,
    notes: z.string().trim().max(5000),
    verified: z.boolean(),
    archived: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.periodEnd < v.periodStart)
      ctx.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "O fim do período deve ser igual ou posterior ao início.",
      });
    if (v.collectedOn < v.periodEnd)
      ctx.addIssue({
        code: "custom",
        path: ["collectedOn"],
        message: "A conferência deve ocorrer no fim do período ou depois dele.",
      });
    if (googleMetrics.every(({ key }) => v[key] === null))
      ctx.addIssue({
        code: "custom",
        message: "Preencha pelo menos uma métrica disponível no Google.",
      });
  });
export type GoogleResult = z.infer<typeof googleResultSchema>;
export const googleResultCommand = z.strictObject({
  type: z.literal("saveGoogleResult"),
  value: googleResultSchema,
});
export function googleProfileKey(
  row: Pick<GoogleResult, "clientId" | "profileName">,
) {
  return `${row.clientId}:${row.profileName.trim().toLocaleLowerCase("pt-BR")}`;
}
export function periodDays(
  row: Pick<GoogleResult, "periodStart" | "periodEnd">,
) {
  return (
    Math.round(
      (Date.parse(`${row.periodEnd}T00:00:00Z`) -
        Date.parse(`${row.periodStart}T00:00:00Z`)) /
        86400000,
    ) + 1
  );
}
export function comparablePeriods(
  current: GoogleResult,
  previous: GoogleResult,
) {
  return (
    current.verified &&
    previous.verified &&
    !current.archived &&
    !previous.archived &&
    googleProfileKey(current) === googleProfileKey(previous) &&
    previous.periodEnd < current.periodStart
  );
}
export function previousGoogleResult(
  current: GoogleResult,
  list: GoogleResult[],
) {
  return (
    list
      .filter((row) => comparablePeriods(current, row))
      .toSorted(
        (a, b) =>
          Number(periodDays(b) === periodDays(current)) -
            Number(periodDays(a) === periodDays(current)) ||
          b.periodEnd.localeCompare(a.periodEnd),
      )[0] ?? null
  );
}
export function metricChange(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  return {
    difference: current - previous,
    percent:
      previous === 0
        ? current === 0
          ? 0
          : null
        : ((current - previous) / previous) * 100,
  };
}
export function googleNumber(value: number | null) {
  return value === null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR").format(value);
}

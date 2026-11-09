import { z } from "zod";
import { isDateOnly } from "./dates.ts";
export const meetingSchema = z
  .strictObject({
    id: z.uuid(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    title: z.string().trim().min(2).max(160),
    clientId: z.uuid().nullable(),
    projectId: z.uuid().nullable(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    status: z.enum(["scheduled", "completed", "cancelled"]),
    location: z.string().trim().max(300),
    meetingUrl: z.union([
      z.literal(""),
      z.url().refine((v) => {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      }, "Use um link HTTPS válido."),
    ]),
    participants: z.string().trim().max(3000),
    agenda: z.string().trim().max(10000),
    outcome: z.string().trim().max(10000),
    reminderMinutes: z.union([z.literal(0), z.literal(60), z.literal(120)]),
    reminderVersion: z.number().int().positive().default(1),
  })
  .refine((v) => {
    const start = Date.parse(v.startsAt),
      end = Date.parse(v.endsAt);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start &&
      end - start <= 86400000
    );
  }, "A reunião precisa terminar após o início, com duração máxima de 24 horas.");
export type Meeting = z.infer<typeof meetingSchema>;
export const meetingCommand = z.strictObject({
  type: z.literal("saveMeeting"),
  value: meetingSchema,
});
export const meetingLabels = {
  scheduled: "Agendada",
  completed: "Realizada",
  cancelled: "Cancelada",
} as const;
const zone = "America/Fortaleza";
const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function meetingLocalTime(iso: string) {
  const parts = localFormatter.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function meetingTimestamp(local: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ||
    !isDateOnly(local.slice(0, 10))
  )
    throw new Error("Informe uma data e um horário válidos.");
  const [y, m, d, h, min] = local.split(/[-T:]/).map(Number);
  if (h > 23 || min > 59) throw new Error("Horário inválido.");
  const iso = new Date(Date.UTC(y, m - 1, d, h + 3, min)).toISOString();
  if (meetingLocalTime(iso) !== local) throw new Error("Horário inválido.");
  return iso;
}
export function meetingWhen(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

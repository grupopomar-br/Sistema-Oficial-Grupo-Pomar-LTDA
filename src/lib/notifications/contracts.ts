import { z } from "zod";
export function safePushEndpoint(value: string) {
  try {
    const u = new URL(value),
      h = u.hostname;
    return (
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      value.length <= 2048 &&
      (h === "fcm.googleapis.com" ||
        h === "updates.push.services.mozilla.com" ||
        h.endsWith(".push.services.mozilla.com") ||
        h === "web.push.apple.com" ||
        h.endsWith(".push.apple.com") ||
        h.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export const subscriptionSchema = z.strictObject({
  endpoint: z
    .string()
    .refine(safePushEndpoint, "Serviço de notificações não reconhecido."),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export const notificationSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["sale", "meeting", "test"]),
  title: z.string().max(160),
  message: z.string().max(500),
  sourceId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  amountCents: z
    .number()
    .int()
    .positive()
    .max(100_000_000_000)
    .nullable()
    .optional(),
  meetingStartsAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type AppNotification = z.infer<typeof notificationSchema>;
export const notificationListSchema = z.strictObject({
  available: z.boolean(),
  items: z.array(notificationSchema).max(100),
  unread: z.number().int().min(0),
  lastDispatchAt: z.iso.datetime({ offset: true }).nullable(),
  pushConfigured: z.boolean().default(false),
  publicKey: z.string().default(""),
});
export type NotificationList = z.infer<typeof notificationListSchema>;
export const emptyNotifications: NotificationList = {
  available: false,
  items: [],
  unread: 0,
  lastDispatchAt: null,
  pushConfigured: false,
  publicKey: "",
};
export function pushMessage(
  kind: "sale" | "meeting" | "test",
  sourceId: string,
  details: {
    amountCents?: number | null;
    meetingStartsAt?: string | null;
  } = {},
) {
  const amount =
    kind === "sale" &&
    Number.isSafeInteger(details.amountCents) &&
    details.amountCents! > 0 &&
    details.amountCents! <= 100_000_000_000
      ? details.amountCents!
      : null;
  const at =
    kind === "meeting" &&
    details.meetingStartsAt &&
    Number.isFinite(Date.parse(details.meetingStartsAt))
      ? details.meetingStartsAt
      : null;
  const phrases = [
    "Mais um passo para construir o Grupo Pomar. 💚",
    "Uma conquista de cada vez. Seguimos em frente. 💚",
    "Continue com constância. Seu trabalho está avançando. 💚",
  ];
  const phrase =
    phrases[
      (parseInt(sourceId.replaceAll("-", "").slice(-2), 16) || 0) %
        phrases.length
    ];
  return {
    kind,
    sourceId,
    amountCents: amount,
    meetingStartsAt: at,
    title:
      kind === "sale"
        ? amount === null
          ? "Pagamento confirmado 💚"
          : `Pagamento confirmado · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount / 100)}`
        : kind === "meeting"
          ? at
            ? `Sua reunião é às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }).format(new Date(at))}`
            : "Sua próxima reunião está chegando"
          : "Tudo pronto por aqui 💚",
    body:
      kind === "sale"
        ? phrase
        : kind === "meeting"
          ? "Reserve um momento para a pauta. Uma boa conversa começa com preparo."
          : "Seus avisos estão ativos. Agora é foco no que faz o Grupo Pomar avançar.",
  };
}

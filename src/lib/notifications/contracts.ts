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
) {
  return {
    kind,
    sourceId,
    title:
      kind === "sale"
        ? "Pagamento Pix confirmado"
        : kind === "meeting"
          ? "Lembrete de reunião"
          : "Notificações do Grupo Pomar",
    body:
      kind === "sale"
        ? "Abra a Central para conferir o recebimento."
        : kind === "meeting"
          ? "Confira o horário e os detalhes na sua Central."
          : "Este aparelho está recebendo os avisos da sua Central.",
  };
}

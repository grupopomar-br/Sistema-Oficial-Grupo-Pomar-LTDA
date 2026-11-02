// Only push delivery. Private pages and API responses are never cached here.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {}
  const kind = ["sale", "meeting"].includes(payload.kind)
    ? payload.kind
    : "test";
  const sourceId =
    typeof payload.sourceId === "string" &&
    /^[0-9a-f-]{36}$/.test(payload.sourceId)
      ? payload.sourceId
      : "general";
  const content =
    kind === "sale"
      ? [
          "Pagamento Pix confirmado",
          "Abra a Central para conferir o recebimento.",
          "collections",
        ]
      : kind === "meeting"
        ? [
            "Lembrete de reunião",
            "Confira o horário e os detalhes na sua Central.",
            "meetings",
          ]
        : [
            "Notificações do Grupo Pomar",
            "Este aparelho está recebendo os avisos da sua Central.",
            "notifications",
          ];
  event.waitUntil(
    self.registration.showNotification(content[0], {
      body: content[1],
      icon: "/brand/pomar-app-192.png",
      tag: `pomar-${kind}-${sourceId}`,
      data: { view: content[2] },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const view = ["collections", "meetings", "notifications"].includes(
    event.notification.data?.view,
  )
    ? event.notification.data.view
    : "notifications";
  const target = new URL(`/central?view=${view}`, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const existing = windows.find((w) =>
          w.url.startsWith(`${self.location.origin}/central`),
        );
        if (existing) {
          await existing.navigate(target);
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});

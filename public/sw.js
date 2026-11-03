// Only push delivery. Private pages and API responses are never cached here.
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
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
  const amount =
    kind === "sale" &&
    Number.isSafeInteger(payload.amountCents) &&
    payload.amountCents > 0 &&
    payload.amountCents <= 100000000000
      ? payload.amountCents
      : null;
  const at =
    kind === "meeting" &&
    typeof payload.meetingStartsAt === "string" &&
    Number.isFinite(Date.parse(payload.meetingStartsAt))
      ? payload.meetingStartsAt
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
  const content =
    kind === "sale"
      ? [
          amount === null
            ? "Pagamento confirmado 💚"
            : `Pagamento confirmado · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount / 100)}`,
          phrase,
          "collections",
        ]
      : kind === "meeting"
        ? [
            at
              ? `Sua reunião é às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }).format(new Date(at))}`
              : "Sua próxima reunião está chegando",
            "Reserve um momento para a pauta. Uma boa conversa começa com preparo.",
            "meetings",
          ]
        : [
            "Tudo pronto por aqui 💚",
            "Seus avisos estão ativos. Agora é foco no que faz o Grupo Pomar avançar.",
            "notifications",
          ];
  event.waitUntil(
    self.registration.showNotification(content[0], {
      body: content[1],
      icon: "/brand/pomar-metal-192.png",
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

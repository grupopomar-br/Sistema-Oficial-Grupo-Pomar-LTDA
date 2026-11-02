import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createECDH } from "node:crypto";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import { applyCommand } from "../src/lib/domain/workspace.ts";
import { importBackup, exportBackup } from "../src/lib/domain/backup.ts";
import {
  meetingTimestamp,
  meetingLocalTime,
  meetingSchema,
} from "../src/lib/domain/meetings.ts";
import { safePushEndpoint } from "../src/lib/notifications/contracts.ts";
import { deliverBatch } from "../src/lib/notifications/delivery.ts";
import { parseNotificationConfig } from "../src/lib/config/notifications.ts";
const meeting = () => ({
  ...newBase(),
  title: "Reunião de exemplo",
  clientId: null,
  projectId: null,
  startsAt: "2026-11-05T15:00:00Z",
  endsAt: "2026-11-05T16:00:00Z",
  status: "scheduled",
  location: "",
  meetingUrl: "https://meet.google.com/example",
  participants: "Participante fictício",
  agenda: "Escopo",
  outcome: "",
  reminderMinutes: 120,
  reminderVersion: 1,
});
test("agenda usa Fortaleza, preserva vínculos/conflitos e altera revisão de lembrete só ao mudar agendamento", () => {
  assert.equal(
    meetingTimestamp("2026-11-05T12:00"),
    "2026-11-05T15:00:00.000Z",
  );
  assert.equal(meetingLocalTime("2026-11-06T01:00:00Z"), "2026-11-05T22:00");
  assert.throws(() => meetingTimestamp("2026-02-30T12:00"));
  assert.equal(
    meetingSchema.safeParse({ ...meeting(), endsAt: "2026-11-04T16:00:00Z" })
      .success,
    false,
  );
  assert.equal(
    meetingSchema.safeParse({ ...meeting(), meetingUrl: "javascript:alert(1)" })
      .success,
    false,
  );
  let state = emptyWorkspace();
  const save = (value) => {
    state = applyCommand(state, {
      commandId: crypto.randomUUID(),
      command: { type: "saveMeeting", value },
    });
  };
  save(meeting());
  const initial = state.meetings[0];
  save({ ...initial, agenda: "Pauta revisada" });
  assert.equal(state.meetings[0].reminderVersion, 1);
  assert.throws(() => save(initial), /alterado/);
  save({ ...state.meetings[0], status: "cancelled" });
  assert.equal(state.meetings[0].reminderVersion, 2);
  assert.deepEqual(importBackup(exportBackup(state)), state);
});
test("endpoints push recusam SSRF, credenciais e portas alternativas", () => {
  for (const endpoint of [
    "http://localhost/x",
    "https://127.0.0.1/x",
    "https://evil.example/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://u:p@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:444/x",
  ])
    assert.equal(safePushEndpoint(endpoint), false);
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/example",
    "https://updates.push.services.mozilla.com/wpush/example",
    "https://web.push.apple.com/example",
  ])
    assert.equal(safePushEndpoint(endpoint), true);
});
test("configuração push é opcional e exige papel restrito, projeto correto e par VAPID correspondente", () => {
  assert.deepEqual(parseNotificationConfig({}), { enabled: false });
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const env = {
    NODE_ENV: "production",
    POMAR_ENVIRONMENT: "production",
    NEXT_PUBLIC_APP_URL: "https://example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://testproject.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnop",
    POMAR_OWNER_USER_ID: "11111111-1111-4111-8111-111111111111",
    POMAR_NOTIFICATIONS_ENABLED: "true",
    POMAR_NOTIFICATIONS_DATABASE_URL:
      "postgres://pomar_notification_worker.testproject:fakepass@aws-0-test.pooler.supabase.com:6543/postgres",
    POMAR_VAPID_PUBLIC_KEY: ec.getPublicKey().toString("base64url"),
    POMAR_VAPID_PRIVATE_KEY: ec.getPrivateKey().toString("base64url"),
    POMAR_NOTIFICATIONS_CRON_SECRET: "A".repeat(43),
  };
  assert.equal(parseNotificationConfig(env).enabled, true);
  for (const changes of [
    {
      POMAR_NOTIFICATIONS_DATABASE_URL:
        env.POMAR_NOTIFICATIONS_DATABASE_URL.replace(
          "pomar_notification_worker.testproject",
          "postgres.testproject",
        ),
    },
    {
      POMAR_NOTIFICATIONS_DATABASE_URL:
        env.POMAR_NOTIFICATIONS_DATABASE_URL.replace(
          "testproject:",
          "otherproject:",
        ),
    },
    { POMAR_VAPID_PUBLIC_KEY: "B".repeat(87) },
    { POMAR_NOTIFICATIONS_CRON_SECRET: "short" },
  ])
    assert.throws(() => parseNotificationConfig({ ...env, ...changes }));
});
test("entrega verifica validade, limita TTL, desativa endpoint expirado e separa falha temporária de definitiva", async () => {
  const now = Date.now();
  const jobs = Array.from({ length: 6 }, (_, i) => ({
    id: crypto.randomUUID(),
    lease: crypto.randomUUID(),
    kind: "meeting",
    sourceId: crypto.randomUUID(),
    expiresAt: new Date(now + (i === 5 ? -1000 : 120000)).toISOString(),
    subscription: {
      endpoint: `https://fcm.googleapis.com/${i}`,
      keys: { auth: "A".repeat(22), p256dh: "A".repeat(87) },
    },
  }));
  const ack = [],
    sent = [];
  const result = await deliverBatch(
    jobs,
    {
      valid: async (j) => j !== jobs[4],
      send: async (j, m, ttl) => {
        sent.push(j.id);
        assert.equal(ttl, 120);
        assert.ok(!JSON.stringify(m).includes("amount"));
        if (j === jobs[1]) throw { statusCode: 410 };
        if (j === jobs[2]) throw { statusCode: 503 };
        if (j === jobs[3]) throw { statusCode: 400 };
      },
      ack: async (j, o) => {
        ack.push([j.id, o]);
      },
    },
    now,
  );
  assert.deepEqual(result, { claimed: 6, sent: 1, retry: 1, failed: 4 });
  assert.equal(sent.length, 4);
  assert.equal(ack.find(([id]) => id === jobs[1].id)[1], "gone");
});
test("service worker ignora texto e destinos arbitrários e não instala cache de dados privados", async () => {
  const handlers = {};
  let shown, opened, wait;
  const context = {
    self: {
      addEventListener: (e, fn) => {
        handlers[e] = fn;
      },
      location: { origin: "https://example.com" },
      registration: {
        showNotification: async (t, o) => {
          shown = { t, o };
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url) => {
          opened = url;
        },
      },
    },
    URL,
  };
  vm.runInNewContext(
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    context,
  );
  assert.equal(handlers.fetch, undefined);
  handlers.push({
    data: {
      json: () => ({
        kind: "sale",
        title: "Texto arbitrário",
        body: "SEGREDO",
        url: "https://evil.example",
      }),
    },
    waitUntil: (p) => {
      wait = p;
    },
  });
  await wait;
  assert.equal(shown.t, "Pagamento Pix confirmado");
  assert.ok(!JSON.stringify(shown).includes("SEGREDO"));
  handlers.notificationclick({
    notification: { close() {}, data: { view: "https://evil.example" } },
    waitUntil: (p) => {
      wait = p;
    },
  });
  await wait;
  assert.equal(opened, "https://example.com/central?view=notifications");
});

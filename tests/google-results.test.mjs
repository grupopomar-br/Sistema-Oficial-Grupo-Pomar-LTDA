import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import { applyCommand } from "../src/lib/domain/workspace.ts";
import { importBackup, exportBackup } from "../src/lib/domain/backup.ts";
import {
  googleResultSchema,
  metricChange,
  previousGoogleResult,
  comparablePeriods,
  periodDays,
} from "../src/lib/domain/google-results.ts";
import { pushMessage } from "../src/lib/notifications/contracts.ts";
import { fetchWorkspaceSnapshot } from "../src/lib/domain/workspace-snapshot.ts";

const row = () => ({
  ...newBase(),
  clientId: crypto.randomUUID(),
  profileName: "Unidade fictícia",
  profileUrl: "",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  collectedOn: "2026-10-01",
  interactions: 80,
  calls: 0,
  bookings: null,
  directions: 30,
  websiteClicks: 50,
  profileViews: 1200,
  notes: "",
  verified: true,
  archived: false,
});
test("resultados preservam dados ausentes, zeros, períodos, conflitos e vínculos no backup", () => {
  const value = row();
  let state = emptyWorkspace();
  state.clients.push({
    ...newBase(),
    id: value.clientId,
    name: "Cliente fictício",
    kind: "business",
    city: "",
    segment: "",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    notes: "",
    status: "active",
  });
  const save = (v, key = crypto.randomUUID()) => {
    state = applyCommand(
      state,
      { commandId: key, command: { type: "saveGoogleResult", value: v } },
      "2026-11-03T15:00:00Z",
    );
  };
  const key = crypto.randomUUID();
  save(value, key);
  save(value, key);
  assert.equal(state.googleResults.length, 1);
  assert.equal(state.googleResults[0].calls, 0);
  assert.equal(state.googleResults[0].bookings, null);
  assert.deepEqual(importBackup(exportBackup(state)), state);
  assert.throws(
    () =>
      save({
        ...value,
        id: crypto.randomUUID(),
        profileName: " unidade fictícia ",
      }),
    /mesmo período/,
  );
  assert.throws(
    () => save({ ...value, clientId: crypto.randomUUID() }),
    /cliente inexistente/,
  );
  assert.throws(
    () =>
      save({ ...value, periodEnd: "2026-12-01", collectedOn: "2026-12-02" }),
    /futuro/,
  );
  save({ ...state.googleResults[0], calls: 10 });
  assert.throws(() => save(value), /alterado/);
  for (const changes of [
    { calls: -1 },
    { calls: 1.5 },
    { periodStart: "2026-02-30" },
    { collectedOn: "2026-08-30" },
    { profileUrl: "javascript:alert(1)" },
    { profileUrl: "https://user:pass@example.com/" },
    {
      interactions: null,
      calls: null,
      bookings: null,
      directions: null,
      websiteClicks: null,
      profileViews: null,
    },
  ])
    assert.equal(
      googleResultSchema.safeParse({ ...value, ...changes }).success,
      false,
    );
});
test("crescimento não soma pessoas e não inventa percentual com base zero ou período sobreposto", () => {
  assert.deepEqual(metricChange(150, 100), { difference: 50, percent: 50 });
  assert.deepEqual(metricChange(0, 100), { difference: -100, percent: -100 });
  assert.deepEqual(metricChange(0, 0), { difference: 0, percent: 0 });
  assert.deepEqual(metricChange(10, 0), { difference: 10, percent: null });
  assert.equal(metricChange(null, 0), null);
  const previous = row(),
    current = {
      ...previous,
      id: crypto.randomUUID(),
      periodStart: "2026-10-01",
      periodEnd: "2026-10-30",
      collectedOn: "2026-10-31",
    };
  assert.equal(periodDays(current), 30);
  assert.equal(comparablePeriods(current, previous), true);
  assert.equal(
    comparablePeriods(current, { ...previous, periodEnd: "2026-10-02" }),
    false,
  );
  assert.equal(
    comparablePeriods(current, { ...previous, verified: false }),
    false,
  );
  assert.equal(
    comparablePeriods(current, { ...previous, profileName: "Outra unidade" }),
    false,
  );
  assert.equal(
    previousGoogleResult(current, [
      previous,
      { ...previous, id: crypto.randomUUID(), periodStart: "2026-09-02" },
    ])?.id,
    previous.id,
    "prioriza duração igual antes da data mais recente",
  );
});
test("nova consulta mantém compatibilidade apenas para RPC ausente e não oculta autorização", async () => {
  const calls = [];
  const old = { example: true };
  const result = await fetchWorkspaceSnapshot(async (name) => {
    calls.push(name);
    return [
      "pomar_workspace_client_terms",
      "pomar_workspace_cards",
      "pomar_workspace_results",
    ].includes(name)
      ? { data: null, error: { code: "PGRST202" } }
      : { data: old, error: null };
  });
  assert.equal(result.data, old);
  assert.deepEqual(calls, [
    "pomar_workspace_client_terms",
    "pomar_workspace_cards",
    "pomar_workspace_results",
    "pomar_workspace_scheduled",
  ]);
  calls.length = 0;
  await fetchWorkspaceSnapshot(async (name) => {
    calls.push(name);
    return { data: null, error: { code: "42501" } };
  });
  assert.equal(calls.length, 1);
});
test("aviso nativo e conteúdo interno usam valor confirmado e mensagens fixas sem texto ou destino arbitrário", async () => {
  const handlers = {};
  let shown, waiting;
  const sourceId = "11111111-1111-4111-8111-111111111111";
  vm.runInNewContext(
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      self: {
        addEventListener: (event, fn) => {
          handlers[event] = fn;
        },
        registration: {
          showNotification: async (title, options) => {
            shown = { title, ...options };
          },
        },
        location: { origin: "https://example.com" },
      },
      URL,
    },
  );
  for (const kind of ["sale", "meeting", "test"]) {
    const data = pushMessage(kind, sourceId, {
      amountCents: 152990,
      meetingStartsAt: "2026-11-04T15:30:00Z",
    });
    handlers.push({
      data: {
        json: () => ({
          ...data,
          title: "Arbitrário",
          body: "SEGREDO",
          url: "https://evil.example",
        }),
      },
      waitUntil: (p) => {
        waiting = p;
      },
    });
    await waiting;
    assert.equal(shown.title, data.title);
    assert.equal(shown.body, data.body);
    assert.ok(!JSON.stringify(shown).includes("SEGREDO"));
    assert.equal(shown.icon, "/brand/pomar-metal-192.png");
    if (kind === "sale") assert.match(shown.title, /1\.529,90/);
    if (kind === "meeting") assert.match(shown.title, /12:30/);
  }
  for (const invalid of [NaN, -1, 0, 1.2, Number.MAX_SAFE_INTEGER])
    assert.ok(
      !pushMessage("sale", sourceId, { amountCents: invalid }).title.includes(
        "R$",
      ),
    );
  assert.equal(handlers.fetch, undefined);
});

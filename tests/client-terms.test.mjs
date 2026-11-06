import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import {
  clientTermProgress,
  extendClientTerm,
} from "../src/lib/domain/client-term.ts";
import { clientSchema, emptyWorkspace } from "../src/lib/domain/model.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { applyCommand, parseWorkspace } from "../src/lib/domain/workspace.ts";

const start = "2026-11-01";
const end = "2026-12-01";

test("prazo conta dias corridos, com início futuro, encerramento hoje e prorrogação", () => {
  const progress = (date) => clientTermProgress(start, end, date);
  assert.deepEqual(progress("2026-11-16"), {
    total: 30,
    elapsed: 15,
    untilStart: -15,
    untilEnd: 15,
    percent: 50,
  });
  assert.equal(progress("2026-10-31").untilStart, 1);
  assert.equal(progress("2026-10-31").percent, 0);
  assert.equal(progress(end).untilEnd, 0);
  assert.equal(progress("2026-12-02").untilEnd, -1);
  assert.equal(progress("2026-12-02").percent, 100);
  assert.equal(clientTermProgress(start, start, start).percent, 100);
  assert.equal(extendClientTerm(end, 7), "2026-12-08");
  assert.equal(extendClientTerm("2028-02-28", 1), "2028-02-29");
  assert.equal(extendClientTerm("2026-12-31", 1), "2027-01-01");
  for (const days of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER])
    assert.equal(extendClientTerm(end, days), null);
  assert.equal(extendClientTerm("9999-12-31", 1), null);
});

test("PostgreSQL 17: prazos do cliente funcionam sem cartão e preservam snapshots e edições antigos", async () => {
  const termsMigration = "20261106010458_prazos_clientes.sql";
  const cardMigration = "20261103042134_checkout_cartao_parcelado.sql";
  const migration = (name) =>
    readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      "utf8",
    );
  const { db, client, other, admin, actor, worker, command } =
    await pomarFixture({ skipMigrations: [termsMigration, cardMigration] });
  const snapshot = async (rpc = "pomar_workspace_client_terms") =>
    parseWorkspace(camelize((await db.query(`select ${rpc}() w`)).rows[0].w));
  const save = (value, key) => command({ type: "saveClient", value }, key);
  const clientIn = (state) => state.clients.find(({ id }) => id === client);

  try {
    await actor();
    const before = await snapshot("pomar_workspace_results");
    const original = clientIn(before);
    assert.equal(before.clientTermsReady, false);
    assert.equal(original.closedOn, undefined);

    await admin();
    await db.exec(await migration(termsMigration));
    await actor();
    const installed = await snapshot();
    assert.equal(installed.clientTermsReady, true);
    assert.equal(installed.googleResultsReady, true);
    assert.equal(clientIn(installed).closedOn, null);
    assert.equal(clientIn(installed).endsOn, null);

    const withTerm = { ...original, closedOn: start, endsOn: end };
    assert.equal(
      clientSchema.safeParse({ ...withTerm, closedOn: null }).success,
      false,
    );
    await assert.rejects(save({ ...withTerm, endsOn: "2026-10-31" }), {
      code: "23514",
    });
    const key = crypto.randomUUID();
    assert.deepEqual(await save(withTerm, key), { duplicate: false });
    assert.deepEqual(await save(withTerm, key), { duplicate: true });
    const dated = clientIn(await snapshot());
    assert.equal(dated.version, original.version + 1);
    const legacy = clientIn(await snapshot("pomar_workspace_results"));
    assert.equal(legacy.closedOn, undefined);
    assert.equal(legacy.endsOn, undefined);

    await save({ ...legacy, city: "Cidade fictícia" });
    const updated = clientIn(await snapshot());
    assert.equal(updated.closedOn, start);
    assert.equal(updated.endsOn, end);
    const extended = { ...updated, endsOn: extendClientTerm(end, 7) };
    await save(extended);
    await assert.rejects(
      save({ ...updated, endsOn: "2026-12-15" }),
      /POMAR_CONFLICT/,
    );
    assert.equal(clientIn(await snapshot()).endsOn, "2026-12-08");

    let local = { ...emptyWorkspace(), clients: [withTerm] };
    local = applyCommand(local, {
      commandId: crypto.randomUUID(),
      command: {
        type: "saveClient",
        value: { ...original, city: "Outra cidade" },
      },
    });
    assert.equal(clientIn(local).endsOn, end);

    await actor(other);
    await assert.rejects(snapshot(), /POMAR_ACCESS/);
    await assert.rejects(save(extended), /POMAR_ACCESS/);
    await worker();
    await assert.rejects(snapshot(), { code: "42501" });

    await admin();
    await db.exec(await migration(cardMigration));
    await actor();
    const afterCard = await snapshot();
    assert.equal(clientIn(afterCard).endsOn, "2026-12-08");
    const saved = clientIn(afterCard);
    await save({ ...saved, closedOn: null, endsOn: null });
    assert.equal(clientIn(await snapshot()).endsOn, null);
  } finally {
    await db.close();
  }
});

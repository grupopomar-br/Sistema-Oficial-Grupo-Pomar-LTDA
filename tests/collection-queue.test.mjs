import { test } from "node:test";
import assert from "node:assert/strict";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { collectionSummary } from "../src/lib/domain/collections.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";

test("PostgreSQL 17: retirar e retomar uma cobrança preserva saldo, parcela e snapshot legado", async () => {
  const { db, actor, client, command, other, date } = await pomarFixture({
    skipMigrations: [
      "20261103042134_checkout_cartao_parcelado.sql",
      "20261106010458_prazos_clientes.sql",
    ],
  });
  const read = async (rpc = "pomar_workspace_collection_queue") =>
    parseWorkspace(camelize((await db.query(`select ${rpc}() w`)).rows[0].w));
  try {
    await actor();
    await command({
      type: "createContract",
      value: {
        ...newBase(),
        title: "Contrato fictício",
        clientId: client,
        projectId: null,
        totalCents: 10000,
        signedOn: "2026-10-01",
        status: "active",
        notes: "",
      },
      count: 1,
      firstDueOn: "2026-10-01",
    });
    const before = await read();
    const part = before.installments[0];
    const withdrawal = {
      type: "addCollectionAction",
      value: {
        ...newBase(),
        installmentId: part.id,
        kind: "withdraw",
        channel: "manual",
        note: "Cliente pediu uma nova conversa.",
        promiseOn: null,
      },
    };
    const key = crypto.randomUUID();
    assert.deepEqual(await command(withdrawal, key), { duplicate: false });
    assert.deepEqual(await command(withdrawal, key), { duplicate: true });
    const paused = await read();
    assert.equal(paused.collectionQueueReady, true);
    assert.deepEqual(paused.installments, before.installments);
    assert.deepEqual(paused.contracts, before.contracts);
    assert.deepEqual(paused.receipts, before.receipts);
    const summary = collectionSummary(paused, date);
    assert.equal(summary.total, 10000);
    assert.equal(summary.overdue, 10000);
    assert.equal(summary.rows[0].withdrawn?.note, withdrawal.value.note);
    assert.equal(
      (await read("pomar_workspace_results")).collectionActions.length,
      0,
    );
    await command({
      ...withdrawal,
      value: {
        ...withdrawal.value,
        ...newBase(),
        kind: "resume",
        note: "Cobrança retomada.",
      },
    });
    const resumed = await read();
    assert.equal(resumed.collectionActions.length, 2);
    assert.equal(collectionSummary(resumed, date).rows[0].withdrawn, null);
    await actor(other);
    await assert.rejects(read(), /POMAR_ACCESS/);
    await assert.rejects(command(withdrawal), /POMAR_ACCESS/);
  } finally {
    await db.close();
  }
});

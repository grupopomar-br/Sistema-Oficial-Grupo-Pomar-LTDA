import { test } from "node:test";
import assert from "node:assert/strict";
import { cashMovement } from "../src/lib/domain/cash-movement.ts";
import { newBase } from "../src/lib/domain/model.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";

test("caixa mensal separa investimento, gastos pessoais e devoluções sem duplicar saídas", () => {
  const paidOn = "2026-11-05";
  const expense = (amountCents, purpose, category = "infrastructure") => ({
    amountCents,
    purpose,
    category,
    paidOn,
    status: "paid",
  });
  const [prior, current] = cashMovement(
    {
      receipts: [
        { amountCents: 100000, receivedOn: paidOn, status: "confirmed" },
        { amountCents: 5000, receivedOn: null, status: "confirmed" },
        { amountCents: 5000, receivedOn: paidOn, status: "voided" },
        { amountCents: 1000, receivedOn: "2026-10-31", status: "confirmed" },
      ],
      expenses: [
        expense(8000, "tools"),
        expense(6000, "paid_traffic"),
        expense(4000, null, "other"),
        expense(5000, null),
        expense(2500, "personal"),
        expense(500, null, "withdrawal"),
        { ...expense(7000, "investment"), status: "pending" },
      ],
      refunds: [{ amountCents: 25000, occurredOn: paidOn }],
    },
    ["2026-10", "2026-11"],
  );
  assert.equal(prior.cashBalance, 1000);
  assert.equal(current.received, 100000);
  assert.equal(current.invested, 14000);
  assert.equal(current.spending.unclassified, 4000);
  assert.equal(current.spending.personal, 2500);
  assert.equal(current.paidExpenses, 26000);
  assert.equal(current.businessBalance, 52000);
  assert.equal(current.cashBalance, 49000);
});

test("PostgreSQL 17: classificação é atômica, protegida e preservada ao editar com a versão anterior", async () => {
  const { db, actor, command, other, date } = await pomarFixture({
    skipMigrations: [
      "20261103042134_checkout_cartao_parcelado.sql",
      "20261106010458_prazos_clientes.sql",
      "20261109012940_retirar_da_fila_de_cobranca.sql",
    ],
  });
  const read = async (name = "pomar_workspace_expense_purposes") =>
    parseWorkspace(camelize((await db.query(`select ${name}() w`)).rows[0].w));
  const input = {
    ...newBase(),
    title: "Ferramenta fictícia",
    category: "infrastructure",
    purpose: "tools",
    projectId: null,
    amountCents: 2900,
    dueOn: null,
    paidOn: date,
    status: "paid",
    notes: "",
  };
  const save = (value, key) => command({ type: "saveExpense", value }, key);
  try {
    await actor();
    await assert.rejects(save({ ...input, purpose: "invalid" }), {
      code: "23514",
    });
    assert.equal((await read()).expenses.length, 0);
    const key = crypto.randomUUID();
    await save(input, key);
    assert.equal((await save(input, key)).duplicate, true);
    await assert.rejects(
      save({ ...input, purpose: "personal" }, key),
      /POMAR_KEY_REUSED/,
    );
    const legacy = (await read("pomar_workspace_results")).expenses[0];
    assert.equal(legacy.purpose, undefined);
    await save({ ...legacy, notes: "Editado pela versão anterior." });
    const state = await read();
    assert.equal(state.expensePurposesReady, true);
    assert.equal(state.expenses[0].purpose, "tools");
    assert.equal(state.expenses[0].amountCents, 2900);
    await assert.rejects(
      save({ ...input, purpose: "personal" }),
      /POMAR_CONFLICT/,
    );
    await actor(other);
    await assert.rejects(read(), /POMAR_ACCESS/);
    await assert.rejects(save(input), /POMAR_ACCESS/);
  } finally {
    await db.close();
  }
});

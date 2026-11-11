import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { camelize } from "../src/lib/domain/transport.ts";
import { parseWorkspace } from "../src/lib/domain/workspace.ts";
import { getFinanceSummary } from "../src/lib/domain/selectors.ts";
import { collectionSummary } from "../src/lib/domain/collections.ts";

async function billingFixture(options) {
  const fixture = await pomarFixture(options);
  const { db, actor, worker, command, client, date } = fixture;
  const read = async () =>
    parseWorkspace(
      camelize(
        (await db.query("select pomar_workspace_expense_purposes() w")).rows[0]
          .w,
      ),
    );
  const contract = async (amount, count = 1) => {
    const value = {
      ...newBase(),
      title: "Contrato fictício",
      clientId: client,
      projectId: null,
      totalCents: amount,
      signedOn: date,
      status: "active",
      notes: "",
    };
    await command({ type: "createContract", value, count, firstDueOn: date });
    const installments = (await read()).installments.filter(
      (item) => item.contractId === value.id,
    );
    return { id: value.id, installments };
  };
  const checkout = async (part, mode = "live") => {
    const charge = crypto.randomUUID();
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await db.query("select pomar_prepare_charge($1,$2,2)", [charge, part.id]);
    await worker();
    await db.query(
      "select pomar_private.pix_checkout_create($1,$2,$3,'987654321',$4)",
      [charge, hash, `https://central.example.com/pagar/${token}`, mode],
    );
    await actor();
    return { charge, hash };
  };
  const remove = async (id, key = crypto.randomUUID()) =>
    (
      await db.query("select pomar_remove_test_contract($1,$2) result", [
        key,
        id,
      ])
    ).rows[0].result;
  return { ...fixture, read, contract, checkout, remove };
}

test("remove um lançamento com link ainda não usado dos totais e mantém o histórico", async () => {
  const {
    db,
    actor,
    other,
    admin,
    worker,
    contract,
    checkout,
    remove,
    read,
    command,
    date,
  } = await billingFixture({
    skipMigrations: ["20261103042134_checkout_cartao_parcelado.sql"],
  });
  try {
    await actor();
    const demo = await contract(400000, 2);
    const real = await contract(50000);
    await command({
      type: "postReceipt",
      installmentId: real.installments[0].id,
      amountCents: 20000,
      receivedOn: date,
    });
    const { hash } = await checkout(demo.installments[0]);
    const month = date.slice(0, 7);
    const before = await read();
    assert.equal(getFinanceSummary(before, month).signed, 450000);
    assert.equal(getFinanceSummary(before, month).received, 20000);
    await assert.rejects(remove(real.id), /POMAR_TEST_PAYMENT_EXISTS/);
    await actor(other);
    await assert.rejects(remove(demo.id), /POMAR_ACCESS/);
    await admin();
    await db.exec("set session authorization anon");
    await assert.rejects(remove(demo.id), { code: "42501" });
    await worker();
    await assert.rejects(remove(demo.id), { code: "42501" });
    await actor();
    const key = crypto.randomUUID();
    assert.deepEqual(await remove(demo.id, key), { duplicate: false });
    assert.deepEqual(await remove(demo.id, key), { duplicate: true });

    const after = await read();
    const totals = getFinanceSummary(after, month);
    assert.equal(totals.signed, 50000);
    assert.equal(totals.expected, 30000);
    assert.equal(totals.received, 20000);
    assert.equal(collectionSummary(after, date).total, 30000);
    assert.deepEqual(after.receipts, before.receipts);
    assert.deepEqual(after.charges, before.charges);
    assert.match(
      after.contracts.find((item) => item.id === demo.id).notes,
      /removido por ser um teste/,
    );
    assert.ok(
      after.installments
        .filter((item) => item.contractId === demo.id)
        .every((item) => item.status === "cancelled"),
    );
    await worker();
    assert.equal(
      (
        await db.query("select pomar_private.pix_checkout_read($1) checkout", [
          hash,
        ])
      ).rows[0].checkout.status,
      "closed",
    );
  } finally {
    await db.close();
  }
});

test("protege tentativas reais de Pix e cartão e permite remover uma simulação", async () => {
  const { db, admin, actor, worker, contract, checkout, remove, read } =
    await billingFixture();
  try {
    await actor();
    const pix = await contract(10000);
    const card = await contract(10000);
    const pixLink = await checkout(pix.installments[0]);
    const cardLink = await checkout(card.installments[0]);
    await worker();
    const payer = JSON.stringify({
      name: "Pessoa Exemplo",
      email: "pessoa@example.com",
      document: "52998224725",
    });
    assert.equal(
      (
        await db.query(
          "select pomar_private.pix_checkout_begin($1,$2::jsonb) r",
          [pixLink.hash, payer],
        )
      ).rows[0].r.create,
      true,
    );
    assert.equal(
      (
        await db.query("select pomar_private.card_checkout_begin($1) r", [
          cardLink.hash,
        ])
      ).rows[0].r.create,
      true,
    );
    await actor();
    await assert.rejects(remove(pix.id), /POMAR_TEST_CHECKOUT_IN_PROGRESS/);
    await assert.rejects(remove(card.id), /POMAR_TEST_CHECKOUT_IN_PROGRESS/);
    await admin();
    await db.query(
      "update public.pomar_charges set expires_at=now()-interval '1 minute' where id=$1",
      [pixLink.charge],
    );
    await db.query(
      "insert into public.pomar_provider_payments(owner_id,provider_payment_id,charge_id,amount_cents,currency,status,mode,provider_updated_at) select owner_id,'12345678',id,amount_cents,'BRL','pending','live',now() from public.pomar_charges where id=$1",
      [pixLink.charge],
    );
    await db.exec("update pomar_private.billing_config set mode='test'");
    await actor();
    await assert.rejects(remove(pix.id), /POMAR_TEST_PAYMENT_EXISTS/);
    const sandbox = await contract(9000);
    const sandboxLink = await checkout(sandbox.installments[0], "test");
    await worker();
    assert.equal(
      (
        await db.query(
          "select pomar_private.pix_checkout_begin($1,$2::jsonb) r",
          [sandboxLink.hash, payer],
        )
      ).rows[0].r.create,
      true,
    );
    await actor();
    await remove(sandbox.id);
    assert.equal(
      (await read()).contracts.find((item) => item.id === sandbox.id).status,
      "cancelled",
    );
  } finally {
    await db.close();
  }
});

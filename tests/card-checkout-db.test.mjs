import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { databaseCommand } from "../src/lib/domain/transport.ts";
test("PostgreSQL 17: meios exclusivos, URL só após attach, cartão sem liberação fora do caixa e repetição sem baixa duplicada", async () => {
  const f = await pomarFixture(),
    { db, owner, client, date, admin, actor, worker, command } = f;
  try {
    const setup = async () => {
      await actor();
      const contractId = crypto.randomUUID();
      await command({
        type: "createContract",
        value: {
          ...newBase(),
          id: contractId,
          title: "Contrato fictício de cartão",
          clientId: client,
          projectId: null,
          totalCents: 50000,
          signedOn: date,
          status: "active",
          notes: "",
        },
        count: 1,
        firstDueOn: date,
      });
      const part = (
        await db.query(
          "select id from pomar_installments where contract_id=$1",
          [contractId],
        )
      ).rows[0].id;
      const charge = crypto.randomUUID();
      await db.query("select pomar_prepare_charge($1,$2,24)", [charge, part]);
      const token = randomBytes(32).toString("base64url"),
        hash = createHash("sha256").update(token).digest("hex");
      await worker();
      await db.query(
        "select pomar_private.pix_checkout_create($1,$2,$3,'987654321','live')",
        [charge, hash, `https://central.example.com/pagar/${token}`],
      );
      return { contractId, part, charge, hash };
    };
    const view = async (hash) =>
      (
        await db.query("select pomar_private.checkout_read_with_card($1) v", [
          hash,
        ])
      ).rows[0].v;
    const begin = async (hash) =>
      (await db.query("select pomar_private.card_checkout_begin($1) v", [hash]))
        .rows[0].v;
    const attach = async (
      hash,
      lease,
      id = "fixture-pref",
      url = `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=${id}`,
    ) =>
      db.query("select pomar_private.card_checkout_attach($1,$2,$3,$4,12)", [
        hash,
        lease,
        id,
        url,
      ]);
    const payer = JSON.stringify({
      name: "Pagador fictício",
      email: "ficticio@example.com",
      document: "12345678901",
    });
    const a = await setup();
    assert.equal((await view(a.hash)).chosen_method, null);
    const reservation = await begin(a.hash);
    assert.equal(reservation.create, true);
    assert.equal((await view(a.hash)).status, "processing");
    assert.equal((await view(a.hash)).card_url, null);
    await assert.rejects(begin(a.hash), /POMAR_CARD_BUSY/);
    await assert.rejects(
      db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb)", [
        a.hash,
        payer,
      ]),
      /POMAR_METHOD_LOCKED/,
    );
    await assert.rejects(attach(a.hash, crypto.randomUUID()), /POMAR_CONFLICT/);
    await assert.rejects(
      attach(
        a.hash,
        reservation.lease,
        "fixture-pref",
        "https://evil.example/checkout/?pref_id=fixture-pref",
      ),
      /POMAR_BAD_COMMAND/,
    );
    await attach(a.hash, reservation.lease);
    assert.equal((await view(a.hash)).status, "pending");
    assert.equal((await view(a.hash)).max_installments, 12);
    assert.equal((await begin(a.hash)).create, false);
    assert.equal(
      (
        await db.query("select pomar_private.card_checkout_poll($1) v", [
          a.hash,
        ])
      ).rows[0].v,
      true,
    );
    assert.equal(
      (
        await db.query("select pomar_private.card_checkout_poll($1) v", [
          a.hash,
        ])
      ).rows[0].v,
      false,
    );
    const event = {
      providerPaymentId: "123456789",
      externalReference: a.charge,
      collectorId: "987654321",
      mode: "live",
      amountCents: 50000,
      feeCents: 1500,
      refundedCents: 0,
      currency: "BRL",
      status: "approved",
      paidOn: null,
      providerUpdatedAt: new Date().toISOString(),
      refunds: [],
      refundsComplete: true,
      paymentMethod: "credit_card",
      fundsAvailable: false,
    };
    const apply = async (e) =>
      db.query("select pomar_billing_apply_payment($1::jsonb) v", [
        JSON.stringify(databaseCommand(e)),
      ]);
    await apply(event);
    assert.equal(
      (await view(a.hash)).status,
      "paid",
      "cliente vê aprovação sem registrar caixa antecipado",
    );
    await admin();
    assert.equal(
      (await db.query("select count(*)::int n from pomar_receipts")).rows[0].n,
      0,
    );
    await worker();
    await assert.rejects(
      apply({ ...event, paidOn: date }),
      /POMAR_CARD_NOT_RELEASED/,
    );
    const released = {
      ...event,
      fundsAvailable: true,
      paidOn: date,
      providerUpdatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    await apply(released);
    await apply(released);
    await admin();
    assert.equal(
      (await db.query("select count(*)::int n from pomar_receipts")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::int n from pomar_allocations")).rows[0]
        .n,
      1,
    );
    await worker();
    await apply({
      ...event,
      providerPaymentId: "123456790",
      status: "rejected",
      providerUpdatedAt: new Date(Date.now() + 2000).toISOString(),
    });
    assert.equal(
      (await view(a.hash)).status,
      "paid",
      "recusa de outra tentativa não sobrescreve o recebimento existente",
    );
    await actor();
    const latest = (await db.query("select pomar_workspace_cards() w")).rows[0]
      .w;
    const legacy = (await db.query("select pomar_workspace_scheduled() w"))
      .rows[0].w;
    assert.equal(
      latest.provider_payments.find(
        (p) => p.provider_payment_id === event.providerPaymentId,
      ).payment_method,
      "credit_card",
    );
    assert.equal(
      latest.provider_payments.find(
        (p) => p.provider_payment_id === event.providerPaymentId,
      ).funds_available,
      true,
    );
    assert.equal(
      Object.hasOwn(legacy.provider_payments[0], "payment_method"),
      false,
      "formato de snapshot anterior preservado",
    );
    const pix = await setup();
    await db.query("select pomar_private.pix_checkout_begin($1,$2::jsonb)", [
      pix.hash,
      payer,
    ]);
    await assert.rejects(begin(pix.hash), /POMAR_METHOD_LOCKED/);
    const cancelled = await setup(),
      lease = (await begin(cancelled.hash)).lease;
    await attach(cancelled.hash, lease, "cancelled-fixture");
    await apply({
      ...event,
      providerPaymentId: "123456791",
      externalReference: cancelled.charge,
      status: "rejected",
    });
    assert.equal(
      (await view(cancelled.hash)).status,
      "pending",
      "cartão recusado pode ser tentado de novo no mesmo checkout do provedor",
    );
    await actor();
    await command({
      type: "cancelContract",
      id: cancelled.contractId,
      reason: "Cancelamento do cenário fictício.",
    });
    await worker();
    assert.equal((await view(cancelled.hash)).status, "closed");
    assert.equal((await view(cancelled.hash)).card_url, null);
    await assert.rejects(
      db.query("select * from pomar_private.card_checkout_preferences"),
      /permission denied/,
    );
    await worker("pomar_notification_worker");
    await assert.rejects(begin(a.hash), /permission denied/);
    await actor(f.other);
    await assert.rejects(begin(a.hash), /permission denied/);
    await assert.rejects(
      db.query("select pomar_billing_apply_payment('{}'::jsonb)"),
      /permission denied/,
    );
    await admin();
    const role = (
      await db.query(
        "select rolsuper,rolbypassrls from pg_roles where rolname='pomar_billing_worker'",
      )
    ).rows[0];
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
  } finally {
    await db.close();
  }
});

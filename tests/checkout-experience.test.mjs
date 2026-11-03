import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPaymentRoute } from "../src/lib/config/public-payment-routes.ts";
import { watchCheckoutPayment } from "../src/lib/billing/checkout-polling.ts";

test("dispensa renovação de sessão apenas nas rotas públicas de pagamento, sem ampliar para APIs do proprietário", () => {
  const token = "A".repeat(43);
  for (const path of [
    `/pagar/${token}`,
    `/api/checkout/${token}`,
    "/pagamento/visualizar",
    "/pagamento/retorno",
  ])
    assert.equal(isPublicPaymentRoute(path), true, path);
  for (const path of [
    "/central",
    "/entrar",
    "/auth/callback",
    "/api/workspace",
    "/api/commands",
    "/api/billing/charges",
    "/api/billing/reconcile",
    "/api/profile",
    "/api/notifications",
    "/api/notifications/dispatch",
    "/api/session",
    "/api/checkout",
    `/api/checkout/${token}/extra`,
    `/pagar/${token}/central`,
    `/pagar/${token}%2fcentral`,
    "/pagamento/visualizar/central",
    `/pagar/${"A".repeat(42)}`,
    `/pagar/${"A".repeat(44)}`,
  ])
    assert.equal(isPublicPaymentRoute(path), false, path);
});

class Page extends EventTarget {
  visibilityState = "visible";
}
class Window extends EventTarget {
  timers = new Map();
  setInterval(fn, delay) {
    this.timers.set(1, { fn, delay });
    return 1;
  }
  clearInterval(id) {
    this.timers.delete(id);
  }
}
test("consulta ao abrir e ao voltar do banco; evita consultas em aba oculta e remove os ouvintes ao sair", () => {
  const page = new Page(),
    target = new Window();
  let checks = 0;
  const stop = watchCheckoutPayment(() => checks++, page, target);
  assert.equal(checks, 1);
  const timer = target.timers.get(1);
  assert.equal(timer.delay, 25000);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  target.dispatchEvent(new Event("focus"));
  timer.fn();
  assert.equal(checks, 1);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(checks, 2);
  target.dispatchEvent(new Event("focus"));
  assert.equal(checks, 3);
  timer.fn();
  assert.equal(checks, 4);
  stop();
  assert.equal(target.timers.size, 0);
  page.dispatchEvent(new Event("visibilitychange"));
  target.dispatchEvent(new Event("focus"));
  assert.equal(checks, 4);
});

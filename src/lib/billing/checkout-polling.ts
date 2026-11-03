type PageEvents = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;
type WindowEvents = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"
>;

// Only used for existing pending/processing payments. Never generates a charge.
export function watchCheckoutPayment(
  refresh: () => void,
  page: PageEvents = document,
  target: WindowEvents = window,
) {
  const check = () => {
    if (page.visibilityState === "visible") refresh();
  };
  const interval = target.setInterval(check, 25000);
  page.addEventListener("visibilitychange", check);
  target.addEventListener("focus", check);
  check();
  return () => {
    target.clearInterval(interval);
    page.removeEventListener("visibilitychange", check);
    target.removeEventListener("focus", check);
  };
}

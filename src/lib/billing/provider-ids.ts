// Keep opaque provider IDs intact, including the sandbox namespace.
export const orderIdPattern = /^ORD(?:TST)?[0-9A-HJKMNP-TV-Z]{26}$/;
export const providerIdPattern =
  /^(?:\d{1,30}|ORD(?:TST)?[0-9A-HJKMNP-TV-Z]{26})$/;
export const refundIdPattern = /^(?:\d{1,40}|REF[0-9A-HJKMNP-TV-Z]{26})$/;
export function isOrderIdForMode(
  id: unknown,
  mode: "test" | "live",
): id is string {
  return (
    typeof id === "string" &&
    orderIdPattern.test(id) &&
    (mode === "test" || !id.startsWith("ORDTST"))
  );
}

export const checkoutTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const checkoutSlugPattern = /^(?=.{1,48}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseCheckoutPath(segments: readonly string[]) {
  const token = segments.at(-1);
  if (!token || !checkoutTokenPattern.test(token) || segments.length > 2)
    return null;
  const clientSlug = segments.length === 2 ? segments[0] : undefined;
  if (clientSlug !== undefined && !checkoutSlugPattern.test(clientSlug))
    return null;
  return { token, clientSlug };
}

export function checkoutPath(token: string, clientSlug?: string) {
  return clientSlug ? `/pagar/${clientSlug}/${token}` : `/pagar/${token}`;
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { parseEnvironment } from "@/lib/config/environment";
import { isPublicPaymentRoute } from "@/lib/config/public-payment-routes";
import { mediaR2Origin } from "@/lib/config/media";
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  let config: ReturnType<typeof parseEnvironment> | null = null;
  try {
    config = parseEnvironment(process.env);
  } catch {}
  const supabaseOrigin = config ? new URL(config.supabaseUrl).origin : "";
  const pathname = request.nextUrl.pathname;
  const publicMedia =
    pathname === "/envio-vip" || pathname === "/api/envio-vip";
  const r2Origin = pathname === "/envio-vip" ? mediaR2Origin(process.env) : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : " 'strict-dynamic'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} ${r2Origin}${development ? " ws: http: https:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(!development ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers } });
  if (config && !publicMedia && !isPublicPaymentRoute(pathname)) {
    const supabase = createServerClient(
      config.supabaseUrl,
      config.publishableKey,
      {
        cookieOptions: {
          httpOnly: true,
          secure: config.environment !== "development",
          sameSite: "lax",
          path: "/",
        },
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(values) {
            values.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            const forwarded = new Headers(headers);
            forwarded.set("cookie", request.cookies.toString());
            response = NextResponse.next({ request: { headers: forwarded } });
            values.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    await supabase.auth.getClaims();
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

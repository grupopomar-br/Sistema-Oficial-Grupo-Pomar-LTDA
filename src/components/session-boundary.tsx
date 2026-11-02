"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LEGACY_SESSION_POLICY,
  sessionPolicy as parseSessionPolicy,
  type SessionPolicy,
} from "@/lib/domain/security";
export function SessionBoundary({
  mode,
  children,
  sessionPolicy = LEGACY_SESSION_POLICY,
}: {
  mode: "local" | "cloud";
  children: ReactNode;
  sessionPolicy?: SessionPolicy;
}) {
  const last = useRef(0),
    broadcastAt = useRef(0);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (mode !== "cloud") return;
    last.current = Date.now();
    let policy = sessionPolicy;
    let closing = false;
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("pomar-secure-session")
        : null;
    const close = () => {
      if (closing) return;
      closing = true;
      setLocked(true);
      channel?.postMessage({ type: "lock" });
      void fetch("/auth/logout", { method: "POST", credentials: "same-origin" })
        .catch(() => {})
        .finally(() => window.location.replace("/entrar?motivo=inatividade"));
    };
    const activity = () => {
      const now = Date.now();
      if (now - last.current > policy.idleTimeoutMs) {
        close();
        return;
      }
      last.current = now;
      if (now - broadcastAt.current > 30000) {
        channel?.postMessage({ type: "activity", at: now });
        broadcastAt.current = now;
      }
    };
    if (channel)
      channel.onmessage = (event) => {
        if (event.data?.type === "lock") close();
        if (
          event.data?.type === "activity" &&
          typeof event.data.at === "number" &&
          Math.abs(Date.now() - event.data.at) < 60000
        )
          last.current = event.data.at;
      };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((name) =>
      window.addEventListener(name, activity, { passive: true }),
    );
    const interval = window.setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle > policy.idleTimeoutMs) {
        close();
        return;
      }
      if (idle < 60000 && document.visibilityState === "visible")
        void fetch("/api/session", {
          method: "POST",
          credentials: "same-origin",
        })
          .then(async (r) => {
            if (r.status === 401) return close();
            const data = await r.json();
            if (r.status === 403) {
              if (data.code === "MFA_REQUIRED") {
                closing = true;
                window.location.replace(
                  `/seguranca?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
                );
              } else close();
            }
            if (r.ok) policy = parseSessionPolicy(data.policy) ?? policy;
          })
          .catch(() => {});
    }, 30000);
    const focus = () => {
      if (Date.now() - last.current > policy.idleTimeoutMs) close();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(interval);
      channel?.close();
      events.forEach((name) => window.removeEventListener(name, activity));
      window.removeEventListener("focus", focus);
    };
  }, [mode, sessionPolicy]);
  if (locked)
    return (
      <main className="session-locked">
        <h1>Sessão bloqueada.</h1>
        <p>Entre novamente para acessar sua operação.</p>
        <a href="/entrar">Entrar com segurança</a>
      </main>
    );
  return children;
}

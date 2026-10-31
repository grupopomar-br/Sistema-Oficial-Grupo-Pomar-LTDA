"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IDLE_TIMEOUT_MS } from "@/lib/domain/security";
export function SessionBoundary({
  mode,
  children,
}: {
  mode: "local" | "cloud";
  children: ReactNode;
}) {
  const last = useRef(0),
    broadcastAt = useRef(0);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (mode !== "cloud") return;
    last.current = Date.now();
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
      if (now - last.current > IDLE_TIMEOUT_MS) {
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
      if (idle > IDLE_TIMEOUT_MS) {
        close();
        return;
      }
      if (idle < 60000 && document.visibilityState === "visible")
        void fetch("/api/session", {
          method: "POST",
          credentials: "same-origin",
        })
          .then((r) => {
            if (r.status === 401 || r.status === 403) close();
          })
          .catch(() => {});
    }, 30000);
    const focus = () => {
      if (Date.now() - last.current > IDLE_TIMEOUT_MS) close();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(interval);
      channel?.close();
      events.forEach((name) => window.removeEventListener(name, activity));
      window.removeEventListener("focus", focus);
    };
  }, [mode]);
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

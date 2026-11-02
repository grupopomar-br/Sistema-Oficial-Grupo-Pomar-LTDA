"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useWorkspace } from "./workspace-provider";
import {
  emptyNotifications,
  notificationListSchema,
  type NotificationList,
} from "@/lib/notifications/contracts";
type Context = {
  feed: NotificationList;
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
  markRead: (id: string | null) => Promise<boolean>;
};
const NotificationContext = createContext<Context | null>(null);
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { mode } = useWorkspace();
  const [feed, setFeed] = useState<NotificationList>(emptyNotifications),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(mode === "cloud");
  const inFlight = useRef(false),
    activeAt = useRef(0);
  const reload = useCallback(async () => {
    if (mode !== "cloud" || inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      const value = await r.json();
      if (!r.ok)
        throw Error(value.error ?? "Não foi possível consultar os avisos.");
      setFeed(notificationListSchema.parse(value));
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar os avisos.",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [mode]);
  useEffect(() => {
    activeAt.current = Date.now();
    void reload();
    const active = () => {
      activeAt.current = Date.now();
    };
    const focus = () => {
      if (Date.now() - activeAt.current < 60000) void reload();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) =>
      window.addEventListener(e, active, { passive: true }),
    );
    window.addEventListener("focus", focus);
    const tick = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - activeAt.current < 60000
      )
        void reload();
    }, 30000);
    return () => {
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, active));
      window.removeEventListener("focus", focus);
    };
  }, [reload]);
  const markRead = async (id: string | null) => {
    try {
      const r = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(data.error ?? "Não foi possível atualizar os avisos.");
      setFeed(notificationListSchema.parse(data));
      setError("");
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível atualizar os avisos.",
      );
      return false;
    }
  };
  return (
    <NotificationContext.Provider
      value={{ feed, error, loading, reload, markRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw Error("NotificationProvider ausente.");
  return value;
}

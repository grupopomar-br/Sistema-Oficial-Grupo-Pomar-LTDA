"use client";
import { newId } from "@/lib/domain/id";

import { ZodError } from "zod";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  emptyWorkspace,
  type Command,
  type Workspace,
} from "@/lib/domain/model";
import { applyCommand, parseWorkspace } from "@/lib/domain/workspace";
import {
  loadLocalWorkspace,
  persistLocalWorkspace,
} from "@/lib/local/repository";

type Mode = "local" | "cloud";
type Context = {
  state: Workspace;
  mode: Mode;
  loading: boolean;
  saving: boolean;
  error: string | null;
  lastSync: string | null;
  reload: () => Promise<void>;
  execute: (command: Command, commandId?: string) => Promise<boolean>;
  replaceLocal: (value: Workspace) => Promise<boolean>;
  notice: string | null;
  noticeKind: "success" | "error";
  operationError: string | null;
  clearOperationError: () => void;
  dismissNotice: () => void;
};
const WorkspaceContext = createContext<Context | null>(null);
class SessionRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function responseJson(response: Response) {
  const result = await response.json();
  if (!response.ok)
    throw new SessionRequestError(
      result.error ?? "Não foi possível concluir a operação.",
      response.status,
    );
  return result;
}

export function WorkspaceProvider({
  mode,
  children,
}: {
  mode: Mode;
  children: ReactNode;
}) {
  const [state, setState] = useState<Workspace>(() => emptyWorkspace());
  const stateRef = useRef(state);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const locked = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const clearOperationError = useCallback(() => setOperationError(null), []);
  const update = useCallback((value: Workspace) => {
    // An older in-flight read must not overwrite the response of a newer write.
    if (value.revision < stateRef.current.revision) return;
    stateRef.current = value;
    setState(value);
    setLastSync(new Date().toISOString());
  }, []);
  const reload = useCallback(async () => {
    try {
      const value =
        mode === "local"
          ? await loadLocalWorkspace()
          : parseWorkspace(
              (
                await responseJson(
                  await fetch("/api/workspace", { cache: "no-store" }),
                )
              ).workspace,
            );
      update(value);
      setError(null);
    } catch (failure) {
      if (
        mode === "cloud" &&
        failure instanceof SessionRequestError &&
        failure.status === 401
      )
        window.location.replace("/entrar?motivo=sessao");
      setError(
        failure instanceof Error
          ? failure.message
          : "Falha ao carregar os dados.",
      );
    } finally {
      setLoading(false);
    }
  }, [mode, update]);
  useEffect(() => {
    void reload();
    const onFocus = () => {
      if (!locked.current) void reload();
    };
    window.addEventListener("focus", onFocus);
    if (mode === "local" && typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("pomar-workspace-v1");
      channel.current.onmessage = onFocus;
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      channel.current?.close();
      channel.current = null;
    };
  }, [mode, reload]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const execute = useCallback(
    async (command: Command, commandId = newId()): Promise<boolean> => {
      if (locked.current) return false;
      locked.current = true;
      setSaving(true);
      setOperationError(null);
      try {
        const envelope = { commandId, command };
        if (mode === "local") {
          const next = applyCommand(stateRef.current, envelope);
          if (next !== stateRef.current)
            await persistLocalWorkspace(next, stateRef.current.revision);
          update(next);
          channel.current?.postMessage("changed");
        } else {
          const result = await responseJson(
            await fetch("/api/commands", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(envelope),
            }),
          );
          update(parseWorkspace(result.workspace));
        }
        setError(null);
        setNoticeKind("success");
        setNotice("Alteração salva.");
        return true;
      } catch (failure) {
        if (
          mode === "cloud" &&
          failure instanceof SessionRequestError &&
          failure.status === 401
        )
          window.location.replace("/entrar?motivo=sessao");
        const message =
          failure instanceof ZodError
            ? (failure.issues[0]?.message ?? "Revise os campos.")
            : failure instanceof Error
              ? failure.message
              : "Não foi possível salvar.";
        setOperationError(message);
        setNoticeKind("error");
        setNotice(message);
        return false;
      } finally {
        locked.current = false;
        setSaving(false);
      }
    },
    [mode, update],
  );

  const replaceLocal = useCallback(
    async (value: Workspace): Promise<boolean> => {
      if (mode !== "local" || locked.current) return false;
      locked.current = true;
      setSaving(true);
      setOperationError(null);
      try {
        const next = {
          ...parseWorkspace(value),
          revision: stateRef.current.revision + 1,
        };
        await persistLocalWorkspace(next, stateRef.current.revision);
        update(next);
        channel.current?.postMessage("changed");
        setNoticeKind("success");
        setNotice("Espaço local atualizado.");
        return true;
      } catch (failure) {
        const message =
          failure instanceof Error ? failure.message : "Falha ao restaurar.";
        setOperationError(message);
        setNoticeKind("error");
        setNotice(message);
        return false;
      } finally {
        locked.current = false;
        setSaving(false);
      }
    },
    [mode, update],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        state,
        mode,
        loading,
        saving,
        error,
        lastSync,
        reload,
        execute,
        replaceLocal,
        notice,
        noticeKind,
        operationError,
        clearOperationError,
        dismissNotice: () => setNotice(null),
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider ausente.");
  return context;
}

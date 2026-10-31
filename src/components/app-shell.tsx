"use client";
import dynamic from "next/dynamic";
import { SessionBoundary } from "./session-boundary";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Lightbulb,
  CreditCard,
  FolderKanban,
  ListTodo,
  Users,
  Wallet,
  TrendingUp,
  Bell,
  History,
  Settings,
  Search,
  Plus,
  Menu,
  X,
  Target,
  Eye,
  EyeOff,
  RefreshCcw,
  Cloud,
  HardDrive,
  LogOut,
  ArrowRight,
  Check,
  AlertCircle,
  Command as CommandIcon,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace-provider";
import { Badge, Brand, Button, IconButton, Skeleton } from "./ui";
import { EntityDetails, GlobalSearch } from "./details";
import Overview from "./views/overview";
import type { View, ModalState, ViewProps } from "./types";
import { getAlerts, isActiveProject } from "@/lib/domain/selectors";
import { todayDate } from "@/lib/domain/dates";

const Ideas = dynamic(() => import("./views/ideas"), { loading: Skeleton });
const Collections = dynamic(() => import("./views/collections"), {
  loading: Skeleton,
});
const IdeaEditor = dynamic(() => import("./idea-editor"), { ssr: false });
const Projects = dynamic(() => import("./views/projects"), {
  loading: Skeleton,
});
const Tasks = dynamic(() => import("./views/tasks"), { loading: Skeleton });
const Clients = dynamic(() => import("./views/clients"), { loading: Skeleton });
const Finance = dynamic(() => import("./views/finance"), { loading: Skeleton });
const Commercial = dynamic(() => import("./views/commercial"), {
  loading: Skeleton,
});
const Alerts = dynamic(() => import("./views/alerts"), { loading: Skeleton });
const HistoryView = dynamic(() => import("./views/history"), {
  loading: Skeleton,
});
const SettingsView = dynamic(() => import("./views/settings"), {
  loading: Skeleton,
});
const EntityModal = dynamic(() => import("./entity-modal"), { ssr: false });
const navigation = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "projects", label: "Projetos", icon: FolderKanban },
  { id: "tasks", label: "Tarefas", icon: ListTodo },
  { id: "clients", label: "Clientes", icon: Users },
  { id: "finance", label: "Financeiro", icon: Wallet },
  { id: "collections", label: "Cobranças", icon: CreditCard },
  { id: "ideas", label: "Ideias", icon: Lightbulb },
  { id: "commercial", label: "Comercial", icon: TrendingUp },
  { id: "alerts", label: "Alertas", icon: Bell },
  { id: "history", label: "Histórico", icon: History },
] as const;
const validViews = new Set([...navigation.map((item) => item.id), "settings"]);

function Shell({ initialView = "overview" }: { initialView?: View }) {
  const {
    state,
    loading,
    saving,
    error,
    mode,
    lastSync,
    reload,
    notice,
    noticeKind,
    dismissNotice,
  } = useWorkspace();
  const [view, setView] = useState<View>(
    [
      "collections",
      "ideas",
      "overview",
      "clients",
      "projects",
      "tasks",
      "finance",
      "commercial",
      "alerts",
      "history",
      "settings",
    ].includes(initialView)
      ? initialView
      : "overview",
  );
  const [modal, setModal] = useState<ModalState | null>(null);
  const [mobile, setMobile] = useState(false);
  const [hiddenValues, setHiddenValues] = useState(false);
  const [today, setToday] = useState(todayDate);
  const [month, setMonth] = useState(() => todayDate().slice(0, 7));
  const navigate = useCallback((next: View) => {
    setView(next);
    setMobile(false);
    window.history.pushState(null, "", `?view=${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const open = useCallback((value: ModalState) => setModal(value), []);
  useEffect(() => {
    const onBack = () => {
      const next = new URLSearchParams(window.location.search).get("view");
      setView(next && validViews.has(next) ? (next as View) : "overview");
    };
    window.addEventListener("popstate", onBack);
    const interval = window.setInterval(() => setToday(todayDate()), 60000);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModal({ kind: "search" });
      }
    };
    window.addEventListener("keydown", keyboard);
    try {
      setHiddenValues(window.localStorage.getItem("pomar-hide-values") === "1");
    } catch {}
    return () => {
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("keydown", keyboard);
      window.clearInterval(interval);
    };
  }, []);
  const alertCount = useMemo(
    () => getAlerts(state, today).length,
    [state, today],
  );
  const counts: Partial<Record<View, number>> = {
    projects: state.projects.filter(isActiveProject).length,
    tasks: state.tasks.filter((item) => item.status !== "done").length,
    alerts: alertCount,
  };
  const title =
    view === "settings"
      ? "Preferências"
      : (navigation.find((item) => item.id === view)?.label ?? "Visão geral");
  const viewProps: ViewProps = {
    open,
    navigate,
    hiddenValues,
    today,
    month,
    setMonth,
  };
  const privacy = () =>
    setHiddenValues((value) => {
      try {
        window.localStorage.setItem("pomar-hide-values", value ? "0" : "1");
      } catch {}
      return !value;
    });
  return (
    <div className="application">
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      {mobile && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <IconButton
            label="Fechar menu"
            className="mobile-only"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </IconButton>
        </div>
        <nav className="main-navigation" aria-label="Navegação principal">
          {navigation.map((item) => {
            const Icon = item.icon;
            const count = counts[item.id];
            return (
              <button
                type="button"
                key={item.id}
                aria-current={view === item.id ? "page" : undefined}
                className={view === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {count !== undefined && count > 0 && <small>{count}</small>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="focus-rule">
            <div>
              <Target size={17} />
              <span>REGRA DO FOCO</span>
            </div>
            <p>
              Concluir o que vence, protege receita ou destrava outra entrega.
            </p>
          </div>
          <button
            type="button"
            className={`settings-navigation ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} />
            <span>Preferências</span>
          </button>
          <div className="sidebar-profile">
            <span className="profile-avatar">
              {state.settings.displayName.slice(0, 1)}
            </span>
            <div>
              <strong>{state.settings.displayName}</strong>
              <span>Proprietário · {state.settings.businessName}</span>
            </div>
            {mode === "cloud" && (
              <form action="/auth/logout" method="post">
                <IconButton label="Sair do sistema" type="submit">
                  <LogOut size={17} />
                </IconButton>
              </form>
            )}
          </div>
        </div>
      </aside>
      <div className="application-body">
        <header className="app-header">
          <div className="header-title">
            <IconButton
              label="Abrir menu"
              className="mobile-only"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </IconButton>
            <div>
              <span>Seu centro de operação</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="header-actions">
            <IconButton
              label="Registrar ideia"
              onClick={() => open({ kind: "idea" })}
            >
              <Lightbulb size={18} />
            </IconButton>
            <button
              type="button"
              className="global-search-trigger"
              onClick={() => setModal({ kind: "search" })}
            >
              <Search size={17} />
              <span>Buscar na operação</span>
              <kbd>⌘ K</kbd>
            </button>
            <IconButton
              label={
                hiddenValues
                  ? "Mostrar valores financeiros"
                  : "Ocultar valores financeiros"
              }
              onClick={privacy}
            >
              {hiddenValues ? <EyeOff size={18} /> : <Eye size={18} />}
            </IconButton>
            <button
              type="button"
              className="header-notification"
              aria-label={`Abrir ${alertCount} alertas`}
              onClick={() => navigate("alerts")}
            >
              <Bell size={18} />
              {alertCount > 0 && <span />}
            </button>
            <Button
              variant="primary"
              disabled={loading || saving || !!error}
              onClick={() =>
                open({
                  kind:
                    view === "clients"
                      ? "client"
                      : view === "tasks"
                        ? "task"
                        : view === "commercial"
                          ? "opportunity"
                          : "project",
                })
              }
            >
              <Plus size={17} />
              <span>
                {view === "clients"
                  ? "Novo cliente"
                  : view === "tasks"
                    ? "Nova tarefa"
                    : view === "commercial"
                      ? "Oportunidade"
                      : "Novo projeto"}
              </span>
            </Button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="workspace-status">
            <span
              className={`connection-badge ${mode === "local" ? "connection-local" : ""}`}
            >
              {mode === "cloud" ? <Cloud size={13} /> : <HardDrive size={13} />}{" "}
              {mode === "cloud"
                ? "Supabase conectado"
                : "Local · neste navegador"}
            </span>
            <span>
              {saving
                ? "Salvando..."
                : loading
                  ? "Carregando seus registros..."
                  : mode === "local"
                    ? "Exporte backups em Preferências para preservar seu trabalho."
                    : lastSync
                      ? "Registros atualizados nesta sessão."
                      : ""}
            </span>
            <IconButton
              label="Atualizar registros"
              disabled={loading || saving}
              onClick={() => void reload()}
            >
              <RefreshCcw size={14} />
            </IconButton>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>Não foi possível carregar os registros.</strong>
                <p>{error}</p>
              </div>
              <Button onClick={() => void reload()}>Tentar novamente</Button>
            </div>
          )}
          {loading ? (
            <Skeleton />
          ) : error ? (
            <div className="error-empty">
              <p>
                A operação ficará disponível quando o carregamento for
                concluído. Nenhum registro foi substituído por dados de exemplo.
              </p>
            </div>
          ) : (
            <>
              {view === "collections" && <Collections {...viewProps} />}
              {view === "ideas" && <Ideas {...viewProps} />}
              {view === "overview" && <Overview {...viewProps} />}{" "}
              {view === "projects" && <Projects {...viewProps} />}{" "}
              {view === "tasks" && <Tasks {...viewProps} />}{" "}
              {view === "clients" && <Clients {...viewProps} />}{" "}
              {view === "finance" && <Finance {...viewProps} />}{" "}
              {view === "commercial" && <Commercial {...viewProps} />}{" "}
              {view === "alerts" && <Alerts {...viewProps} />}{" "}
              {view === "history" && <HistoryView {...viewProps} />}{" "}
              {view === "settings" && <SettingsView {...viewProps} />}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            Grupo Pomar · Clareza para decidir. Estrutura para crescer.
          </span>
          <span>Central Operacional · v0.4</span>
        </footer>
      </div>
      {modal?.kind === "idea" ? (
        <IdeaEditor id={modal.id} onClose={() => setModal(null)} />
      ) : modal?.kind === "search" ? (
        <GlobalSearch open={open} onClose={() => setModal(null)} />
      ) : modal &&
        (modal.kind === "projectDetail" || modal.kind === "clientDetail") ? (
        <EntityDetails
          modal={modal}
          open={open}
          onClose={() => setModal(null)}
          today={today}
          hiddenValues={hiddenValues}
        />
      ) : modal && modal.kind !== "import" ? (
        <EntityModal modal={modal} onClose={() => setModal(null)} />
      ) : null}
      <nav
        className="mobile-bottom-navigation"
        aria-label="Atalhos da operação no celular"
      >
        {(
          [
            { id: "overview", label: "Início", icon: LayoutDashboard },
            { id: "tasks", label: "Tarefas", icon: ListTodo },
            { id: "collections", label: "Cobranças", icon: CreditCard },
            { id: "ideas", label: "Ideias", icon: Lightbulb },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Abrir todas as áreas"
          onClick={() => setMobile(true)}
        >
          <Menu size={20} />
          <span>Menu</span>
        </button>
      </nav>
      {notice && (
        <div
          className={`toast ${noticeKind === "error" ? "toast-error" : ""}`}
          role="status"
        >
          <span>
            {noticeKind === "error" ? (
              <AlertCircle size={17} />
            ) : (
              <Check size={17} />
            )}
          </span>
          <p>{notice}</p>
          <IconButton label="Fechar aviso" onClick={dismissNotice}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
export default function AppShell({
  mode,
  initialView,
}: {
  mode: "local" | "cloud";
  initialView?: View;
}) {
  return (
    <SessionBoundary mode={mode}>
      <WorkspaceProvider mode={mode}>
        <Shell initialView={initialView} />
      </WorkspaceProvider>
    </SessionBoundary>
  );
}

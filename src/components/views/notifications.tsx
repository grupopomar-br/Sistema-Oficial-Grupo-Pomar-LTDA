"use client";
import { useState } from "react";
import { Bell, CheckCheck, ArrowUpRight, RefreshCcw } from "lucide-react";
import { useNotifications } from "../notification-provider";
import { PushSettings } from "../push-settings";
import { Badge, Button, EmptyState, SectionHeading } from "../ui";
import { meetingWhen } from "@/lib/domain/meetings";
import type { ViewProps } from "../types";
export default function Notifications({ navigate }: ViewProps) {
  const { feed, error, loading, reload, markRead } = useNotifications();
  const [filter, setFilter] = useState("all");
  const items = feed.items.filter(
    (n) =>
      filter === "all" ||
      (filter === "unread" && !n.readAt) ||
      n.kind === filter,
  );
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Os acontecimentos da sua operação.</h2>
          <p>Pagamentos confirmados e lembretes de reunião no mesmo lugar.</p>
        </div>
        <Badge tone="green">{feed.unread} não lidos</Badge>
      </div>
      <section className="panel settings-panel">
        <SectionHeading
          eyebrow="SEU APARELHO"
          title="Notificações que acompanham você"
        />
        <PushSettings />
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !feed.available && (
        <p className="inline-note">
          Os avisos estão aguardando a ativação na sua conta.
        </p>
      )}
      <div className="notification-toolbar">
        <div className="filter-tabs standalone">
          {[
            ["all", "Todos"],
            ["unread", "Não lidos"],
            ["sale", "Pagamentos"],
            ["meeting", "Reuniões"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="button-group">
          <Button disabled={!feed.unread} onClick={() => void markRead(null)}>
            <CheckCheck size={16} />
            Marcar todos como lidos
          </Button>
          <Button disabled={loading} onClick={() => void reload()}>
            <RefreshCcw size={15} />
            Atualizar
          </Button>
        </div>
      </div>
      <section className="panel notification-list">
        {items.length ? (
          items.map((n) => (
            <article
              key={n.id}
              className={
                n.readAt
                  ? "notification-item"
                  : "notification-item notification-unread"
              }
            >
              <span className="list-icon">
                <Bell size={18} />
              </span>
              <div>
                <h3>{n.title}</h3>
                <p>{n.message}</p>
                <small>{meetingWhen(n.occurredAt)}</small>
              </div>
              <Button
                onClick={async () => {
                  await markRead(n.id);
                  navigate(
                    n.kind === "sale"
                      ? "collections"
                      : n.kind === "meeting"
                        ? "meetings"
                        : "settings",
                  );
                }}
              >
                Conferir
                <ArrowUpRight size={15} />
              </Button>
            </article>
          ))
        ) : (
          <EmptyState
            icon={Bell}
            title="Nenhum aviso por aqui."
            description="Os pagamentos confirmados e os lembretes aparecerão nesta lista."
          />
        )}
      </section>
      <Button onClick={() => navigate("alerts")}>
        Ver alertas da operação
        <ArrowUpRight size={15} />
      </Button>
    </div>
  );
}

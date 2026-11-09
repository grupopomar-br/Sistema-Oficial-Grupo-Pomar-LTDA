"use client";
import { useMemo, useState, useEffect } from "react";
import {
  CalendarClock,
  Plus,
  Clock,
  MapPin,
  Video,
  Users,
  Pencil,
} from "lucide-react";
import {
  meetingLocalTime,
  meetingWhen,
  meetingLabels,
} from "@/lib/domain/meetings";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState } from "../ui";
import type { ViewProps } from "../types";
export default function Meetings({ today, open }: ViewProps) {
  const { state, saving } = useWorkspace();
  const [filter, setFilter] = useState("upcoming");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const list = useMemo(
    () =>
      state.meetings
        .filter((m) => {
          const day = meetingLocalTime(m.startsAt).slice(0, 10);
          return (
            (filter === "all" ||
              (filter === "today" &&
                day === today &&
                m.status === "scheduled") ||
              (filter === "upcoming" &&
                m.status === "scheduled" &&
                Date.parse(m.endsAt) >= now) ||
              filter === m.status) &&
            `${m.title} ${m.participants} ${m.agenda} ${state.clients.find((c) => c.id === m.clientId)?.name ?? ""}`
              .toLocaleLowerCase("pt-BR")
              .includes(query.toLocaleLowerCase("pt-BR"))
          );
        })
        .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [state.meetings, state.clients, filter, query, today, now],
  );
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Espaço para boas conversas.</h2>
          <p>Reuniões, pautas e próximos passos organizados na sua agenda.</p>
        </div>
        <Button
          variant="primary"
          disabled={saving || !state.meetingsReady}
          onClick={() => open({ kind: "meeting" })}
        >
          <Plus size={16} />
          Agendar reunião
        </Button>
      </div>
      {!state.meetingsReady && (
        <p className="inline-note">
          A agenda está aguardando a ativação na sua conta.
        </p>
      )}
      <div className="meeting-summary">
        <span className="list-icon">
          <CalendarClock size={23} />
        </span>
        <div>
          <strong>
            {
              state.meetings.filter(
                (m) =>
                  m.status === "scheduled" &&
                  meetingLocalTime(m.startsAt).startsWith(today),
              ).length
            }{" "}
            reuniões agendadas hoje
          </strong>
          <p>
            Horários de Brasília/Fortaleza. Lembretes de 1 ou 2 horas antes,
            conforme sua escolha.
          </p>
        </div>
      </div>
      <div className="methodology-toolbar">
        <input
          aria-label="Buscar reuniões"
          placeholder="Buscar reunião, participante ou cliente"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-tabs standalone">
          {[
            ["upcoming", "Próximas"],
            ["today", "Hoje"],
            ["completed", "Realizadas"],
            ["cancelled", "Canceladas"],
            ["all", "Todas"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="methodology-grid">
          {list.map((m) => (
            <article className="panel meeting-card" key={m.id}>
              <div className="meeting-card-title">
                <h3>{m.title}</h3>
                <Badge tone={m.status === "scheduled" ? "green" : "neutral"}>
                  {meetingLabels[m.status]}
                </Badge>
              </div>
              <p className="meeting-time">
                <Clock size={16} />
                {meetingWhen(m.startsAt)} até{" "}
                {meetingLocalTime(m.startsAt).slice(0, 10) ===
                meetingLocalTime(m.endsAt).slice(0, 10)
                  ? meetingLocalTime(m.endsAt).slice(11)
                  : meetingWhen(m.endsAt)}
              </p>
              {m.clientId && (
                <p>{state.clients.find((c) => c.id === m.clientId)?.name}</p>
              )}
              {m.location && (
                <p>
                  <MapPin size={16} />
                  {m.location}
                </p>
              )}
              {m.participants && (
                <p>
                  <Users size={16} />
                  {m.participants}
                </p>
              )}
              {m.agenda && <p className="meeting-agenda">{m.agenda}</p>}
              <small>
                {m.reminderMinutes
                  ? `Lembrete ${m.reminderMinutes / 60}h antes`
                  : "Sem lembrete"}
              </small>
              <div className="button-group">
                {m.meetingUrl && (
                  <a
                    className="button button-secondary"
                    href={m.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Video size={16} />
                    Abrir reunião
                  </a>
                )}
                <Button onClick={() => open({ kind: "meeting", id: m.id })}>
                  <Pencil size={15} />
                  Detalhes e edição
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="Sua agenda tem espaço."
          description="Agende uma reunião para organizar horário, participantes e pauta."
        />
      )}
    </div>
  );
}

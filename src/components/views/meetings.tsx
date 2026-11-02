"use client";
import { useMemo, useState, useEffect, type FormEvent } from "react";
import {
  CalendarClock,
  Plus,
  Clock,
  MapPin,
  Video,
  Users,
  Check,
  Pencil,
} from "lucide-react";
import { newBase } from "@/lib/domain/model";
import {
  meetingTimestamp,
  meetingLocalTime,
  meetingWhen,
  meetingLabels,
  type Meeting,
} from "@/lib/domain/meetings";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState, Field, Modal } from "../ui";
import type { ViewProps } from "../types";
function blank(): Meeting {
  const start = new Date(
    Math.ceil(Date.now() / 900000) * 900000 + 3600000,
  ).toISOString();
  return {
    ...newBase(),
    title: "",
    clientId: null,
    projectId: null,
    startsAt: start,
    endsAt: new Date(Date.parse(start) + 3600000).toISOString(),
    status: "scheduled",
    location: "",
    meetingUrl: "",
    participants: "",
    agenda: "",
    outcome: "",
    reminderMinutes: 60,
    reminderVersion: 1,
  };
}
export default function Meetings({ today }: ViewProps) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [filter, setFilter] = useState("upcoming"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<Meeting | null>(null),
    [formError, setFormError] = useState("");
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
  const edit = (m: Meeting) => {
    clearOperationError();
    setFormError("");
    setEditing(m);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const f = new FormData(event.currentTarget);
    setFormError("");
    try {
      const value: Meeting = {
        ...editing,
        title: String(f.get("title")),
        clientId: String(f.get("clientId")) || null,
        projectId: String(f.get("projectId")) || null,
        startsAt: meetingTimestamp(String(f.get("startsAt"))),
        endsAt: meetingTimestamp(String(f.get("endsAt"))),
        status: String(f.get("status")) as Meeting["status"],
        location: String(f.get("location")),
        meetingUrl: String(f.get("meetingUrl")),
        participants: String(f.get("participants")),
        agenda: String(f.get("agenda")),
        outcome: String(f.get("outcome")),
        reminderMinutes: Number(f.get("reminderMinutes")) as 0 | 60 | 120,
      };
      if (await execute({ type: "saveMeeting", value })) setEditing(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Revise os horários.");
    }
  };
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
          onClick={() => edit(blank())}
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
                <Button onClick={() => edit(m)}>
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
      {editing && (
        <Modal
          title={editing.title ? "Editar reunião" : "Agendar reunião"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Título" wide>
                <input
                  name="title"
                  defaultValue={editing.title}
                  required
                  minLength={2}
                  maxLength={160}
                  autoFocus
                />
              </Field>
              <Field label="Início (Brasília/Fortaleza)">
                <input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={meetingLocalTime(editing.startsAt)}
                  required
                />
              </Field>
              <Field label="Fim">
                <input
                  type="datetime-local"
                  name="endsAt"
                  defaultValue={meetingLocalTime(editing.endsAt)}
                  required
                />
              </Field>
              <Field label="Cliente">
                <select name="clientId" defaultValue={editing.clientId ?? ""}>
                  <option value="">Sem vínculo</option>
                  {state.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Projeto">
                <select name="projectId" defaultValue={editing.projectId ?? ""}>
                  <option value="">Sem vínculo</option>
                  {state.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lembrete">
                <select
                  name="reminderMinutes"
                  defaultValue={editing.reminderMinutes}
                >
                  <option value={60}>1 hora antes</option>
                  <option value={120}>2 horas antes</option>
                  <option value={0}>Sem lembrete</option>
                </select>
              </Field>
              <Field label="Situação">
                <select name="status" defaultValue={editing.status}>
                  {Object.entries(meetingLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Local" wide>
                <input
                  name="location"
                  defaultValue={editing.location}
                  maxLength={300}
                />
              </Field>
              <Field label="Link da reunião" wide>
                <input
                  type="url"
                  name="meetingUrl"
                  defaultValue={editing.meetingUrl}
                  placeholder="https://"
                  maxLength={2048}
                />
              </Field>
              <Field label="Participantes (para sua organização)" wide>
                <textarea
                  name="participants"
                  rows={2}
                  defaultValue={editing.participants}
                  maxLength={3000}
                />
              </Field>
              <Field label="Pauta e preparação" wide>
                <textarea
                  name="agenda"
                  rows={4}
                  defaultValue={editing.agenda}
                  maxLength={10000}
                />
              </Field>
              <Field label="Decisões e próximos passos" wide>
                <textarea
                  name="outcome"
                  rows={4}
                  defaultValue={editing.outcome}
                  maxLength={10000}
                />
              </Field>
            </div>
            <div className="form-footer">
              {(formError || operationError) && (
                <p className="form-error" role="alert">
                  {formError || operationError}
                </p>
              )}
              <Button disabled={saving} onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                <Check size={16} />
                Salvar reunião
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

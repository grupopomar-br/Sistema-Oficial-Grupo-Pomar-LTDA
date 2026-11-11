"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { newBase } from "@/lib/domain/model";
import {
  meetingLocalTime,
  meetingTimestamp,
  meetingLabels,
  type Meeting,
} from "@/lib/domain/meetings";
import { useWorkspace } from "./workspace-provider";
import { Button, Field, Modal } from "./ui";

function blank(day?: string): Meeting {
  const start = day
    ? meetingTimestamp(`${day}T09:00`)
    : new Date(Math.ceil(Date.now() / 900000) * 900000 + 3600000).toISOString();
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

export default function MeetingEditor({
  id,
  day,
  onClose,
}: {
  id?: string;
  day?: string;
  onClose: () => void;
}) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [editing] = useState(() =>
    id ? state.meetings.find((meeting) => meeting.id === id) : blank(day),
  );
  const [formError, setFormError] = useState("");
  useEffect(() => clearOperationError(), [clearOperationError]);
  if (!editing) return null;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      if (await execute({ type: "saveMeeting", value })) onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Revise os horários.");
    }
  };
  return (
    <Modal
      title={editing.title ? "Editar reunião" : "Agendar reunião"}
      onClose={onClose}
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
              {state.projects
                .filter((p) => !p.removedAt || p.id === editing.projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.removedAt ? " · removido" : ""}
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
          <Button disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            <Check size={16} />
            Salvar reunião
          </Button>
        </div>
      </form>
    </Modal>
  );
}

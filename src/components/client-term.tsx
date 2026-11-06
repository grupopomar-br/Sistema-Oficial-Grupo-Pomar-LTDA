"use client";

import { useState } from "react";
import {
  clientTermProgress,
  extendClientTerm,
  lastClientTermDate,
} from "@/lib/domain/client-term";
import { daysBetween, fullDate } from "@/lib/domain/dates";
import type { Client } from "@/lib/domain/model";
import { Field } from "./ui";

const dayLabel = (days: number) => `${days} ${days === 1 ? "dia" : "dias"}`;

function termStatus(untilStart: number, untilEnd: number) {
  if (untilStart > 0) return `Começa em ${dayLabel(untilStart)}`;
  if (untilEnd < 0) return `Prazo encerrado há ${dayLabel(-untilEnd)}`;
  if (untilEnd === 0) return "Encerra hoje";
  return untilEnd === 1 ? "Falta 1 dia" : `Faltam ${dayLabel(untilEnd)}`;
}

export function ClientTermSummary({
  client: { closedOn, endsOn },
  today,
}: {
  client: Client;
  today: string;
}) {
  if (!closedOn)
    return <div className="client-term-caption">Prazo a definir</div>;
  const progress = endsOn ? clientTermProgress(closedOn, endsOn, today) : null;
  const elapsed = progress?.total
    ? `${progress.elapsed} de ${dayLabel(progress.total)}`
    : "Prazo de um dia";
  return (
    <div className="client-term-summary">
      <div className="client-term-dates">
        <div>
          <span>Fechado em</span>
          <time dateTime={closedOn}>{fullDate(closedOn)}</time>
        </div>
        <div>
          <span>Encerramento</span>
          {endsOn ? (
            <time dateTime={endsOn}>{fullDate(endsOn)}</time>
          ) : (
            <strong>A definir</strong>
          )}
        </div>
      </div>
      {progress && (
        <>
          <progress
            max={100}
            value={progress.percent}
            aria-label="Progresso do prazo"
            aria-valuetext={elapsed}
          />
          <div className="client-term-count">
            <strong>
              {termStatus(progress.untilStart, progress.untilEnd)}
            </strong>
            <span>{elapsed}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function ClientTermFields({
  client,
  autoFocus = false,
}: {
  client: Client;
  autoFocus?: boolean;
}) {
  return (
    <div className="form-grid client-term-fields">
      <Field label="Data de fechamento">
        <input
          name="closedOn"
          type="date"
          min="0001-01-01"
          max={lastClientTermDate}
          defaultValue={client.closedOn ?? ""}
          autoFocus={autoFocus}
        />
      </Field>
      <Field label="Data de encerramento">
        <input
          name="endsOn"
          type="date"
          min="0001-01-01"
          max={lastClientTermDate}
          defaultValue={client.endsOn ?? ""}
        />
      </Field>
    </div>
  );
}

export function ClientTermExtension({ endsOn }: { endsOn: string }) {
  const [days, setDays] = useState("");
  const next = extendClientTerm(endsOn, Number(days));
  return (
    <div className="client-term-fields">
      <p className="client-term-caption">
        Encerramento atual em <strong>{fullDate(endsOn)}</strong>
      </p>
      <Field label="Dias corridos a acrescentar">
        <input
          name="extraDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={daysBetween(endsOn, lastClientTermDate)}
          step={1}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          required
          autoFocus
        />
      </Field>
      <p className="client-term-preview" aria-live="polite">
        {next ? (
          <>
            Novo encerramento em <strong>{fullDate(next)}</strong>
          </>
        ) : (
          "Os dias serão somados ao encerramento atual."
        )}
      </p>
    </div>
  );
}

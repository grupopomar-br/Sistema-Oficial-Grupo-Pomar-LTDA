"use client";
import { useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { newBase } from "@/lib/domain/model";
import type { Methodology } from "@/lib/domain/personalization";
import { shortDate } from "@/lib/domain/dates";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState, Field, Modal } from "../ui";

const sections = [
  {
    key: "purpose",
    label: "Objetivo do serviço",
    hint: "Que resultado este serviço busca entregar?",
    max: 3000,
  },
  {
    key: "steps",
    label: "Etapas e processo",
    hint: "Descreva a sequência, os responsáveis e os pontos de conferência.",
    max: 20000,
  },
  {
    key: "differentiators",
    label: "Diferenciais",
    hint: "O que distingue a sua forma de trabalhar?",
    max: 8000,
  },
  {
    key: "deliverables",
    label: "Entregáveis",
    hint: "O que o cliente recebe ao final de cada etapa?",
    max: 8000,
  },
  {
    key: "qualityCriteria",
    label: "Critérios de qualidade",
    hint: "O que precisa ser conferido antes de considerar o serviço concluído?",
    max: 8000,
  },
  {
    key: "notes",
    label: "Notas e referências",
    hint: "Aprendizados, materiais e observações para a próxima execução.",
    max: 10000,
  },
] as const;
function blank(): Methodology {
  return {
    ...newBase(),
    title: "",
    service: "",
    purpose: "",
    steps: "",
    differentiators: "",
    deliverables: "",
    qualityCriteria: "",
    notes: "",
    archived: false,
  };
}

export default function Methodologies() {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Methodology | null>(null);
  const [reading, setReading] = useState<Methodology | null>(null);
  const list = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return state.methodologies
      .filter(
        (item) =>
          item.archived === archived &&
          (!term ||
            [
              item.title,
              item.service,
              ...sections.map((s) => item[s.key]),
            ].some((text) => text.toLocaleLowerCase("pt-BR").includes(term))),
      )
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [state.methodologies, archived, query]);
  const edit = (item: Methodology) => {
    clearOperationError();
    setReading(null);
    setEditing(item);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const value = {
      ...editing,
      title: String(form.get("title")),
      service: String(form.get("service")),
      ...Object.fromEntries(
        sections.map((section) => [
          section.key,
          String(form.get(section.key) ?? ""),
        ]),
      ),
    } as Methodology;
    if (await execute({ type: "saveMethodology", value })) setEditing(null);
  };
  const archive = async (item: Methodology) => {
    clearOperationError();
    if (
      await execute({
        type: "saveMethodology",
        value: { ...item, archived: !item.archived },
      })
    )
      setReading(null);
  };
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Seu jeito de fazer, bem documentado.</h2>
          <p>
            Metodologias, diferenciais e critérios para repetir o que funciona.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!state.personalizationReady || saving}
          onClick={() => edit(blank())}
        >
          <Plus size={17} />
          Nova metodologia
        </Button>
      </div>
      {!state.personalizationReady && (
        <div className="inline-note">
          Esta área está aguardando a ativação na sua conta. Seus registros
          atuais continuam disponíveis.
        </div>
      )}
      <div className="methodology-toolbar">
        <label className="methodology-search">
          <Search size={17} />
          <input
            aria-label="Buscar metodologias"
            placeholder="Buscar serviço, etapa ou diferencial"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          <span>Mostrar arquivadas</span>
        </label>
        <Badge>
          {list.length} {list.length === 1 ? "metodologia" : "metodologias"}
        </Badge>
      </div>
      {list.length ? (
        <div className="methodology-grid">
          {list.map((item) => (
            <article className="panel methodology-card" key={item.id}>
              <div className="methodology-card-top">
                <span className="list-icon">
                  <BookOpen size={21} />
                </span>
                <Badge tone={archived ? "neutral" : "green"}>
                  {item.service || "Serviço a definir"}
                </Badge>
              </div>
              <h3>{item.title}</h3>
              <p className="methodology-summary">
                {item.purpose ||
                  "Registre o objetivo e desenvolva as etapas desta metodologia."}
              </p>
              <div className="methodology-card-footer">
                <small>
                  Atualizada em {shortDate(item.updatedAt.slice(0, 10))}
                </small>
                <Button onClick={() => setReading(item)}>
                  Consultar
                  <ArrowUpRight size={15} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title={
            query
              ? "Nenhuma metodologia encontrada."
              : archived
                ? "Nenhuma metodologia arquivada."
                : "Comece pelo serviço que você mais entrega."
          }
          description={
            query
              ? "Tente outro termo de busca."
              : "Guarde o processo, os diferenciais e o padrão de qualidade da sua operação aqui."
          }
        />
      )}
      {reading && (
        <Modal title={reading.title} onClose={() => setReading(null)}>
          <div className="methodology-reading">
            <Badge tone="green">{reading.service || "Serviço a definir"}</Badge>
            {sections.map((section) => (
              <section key={section.key}>
                <h3>{section.label}</h3>
                <p>{reading[section.key] || "Ainda não preenchido."}</p>
              </section>
            ))}
          </div>
          {operationError && (
            <p className="form-error" role="alert">
              {operationError}
            </p>
          )}
          <div className="form-footer">
            <Button disabled={saving} onClick={() => void archive(reading)}>
              {reading.archived ? (
                <RotateCcw size={16} />
              ) : (
                <Archive size={16} />
              )}
              {reading.archived ? "Restaurar" : "Arquivar"}
            </Button>
            <Button variant="primary" onClick={() => edit(reading)}>
              <Pencil size={16} />
              Editar metodologia
            </Button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing.title ? "Editar metodologia" : "Nova metodologia"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={save} className="methodology-form">
            <div className="form-grid">
              <Field label="Nome da metodologia" wide>
                <input
                  name="title"
                  defaultValue={editing.title}
                  required
                  minLength={2}
                  maxLength={160}
                  autoFocus
                />
              </Field>
              <Field label="Serviço ou especialidade" wide>
                <input
                  name="service"
                  defaultValue={editing.service}
                  maxLength={120}
                  placeholder="Nome do seu serviço"
                />
              </Field>
              {sections.map((section) => (
                <Field key={section.key} label={section.label} wide>
                  <textarea
                    name={section.key}
                    defaultValue={editing[section.key]}
                    rows={section.key === "steps" ? 7 : 4}
                    maxLength={section.max}
                    placeholder={section.hint}
                  />
                </Field>
              ))}
            </div>
            <div className="form-footer">
              {operationError && (
                <p className="form-error" role="alert">
                  {operationError}
                </p>
              )}
              <Button disabled={saving} onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                <Check size={16} />
                Salvar metodologia
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

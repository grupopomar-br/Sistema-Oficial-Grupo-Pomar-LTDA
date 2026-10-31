"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Lightbulb, Check } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Button, Field, Modal } from "./ui";
import { newBase } from "@/lib/domain/model";
import type { Idea } from "@/lib/domain/extensions";
export const ideaCategories = {
  general: "Geral",
  operations: "Operação",
  billing: "Cobrança",
  security: "Segurança",
  automation: "Automação",
  product: "Produto",
};
export const ideaStages = {
  inbox: "Caixa de entrada",
  planned: "Planejada",
  doing: "Em execução",
  done: "Implementada",
  archived: "Arquivada",
};
export default function IdeaEditor({
  id,
  onClose,
}: {
  id?: string;
  onClose: () => void;
}) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [commandId] = useState(() => newBase().id);
  const [initial] = useState<Idea>(
    () =>
      state.ideas.find((i) => i.id === id) ?? {
        ...newBase(),
        title: "",
        detail: "",
        category: "general",
        priority: "P2",
        stage: "inbox",
        taskId: null,
      },
  );
  useEffect(() => {
    clearOperationError();
  }, [clearOperationError]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await execute(
        {
          type: "saveIdea",
          value: {
            ...initial,
            title: String(form.get("title")),
            detail: String(form.get("detail")),
            category: String(form.get("category")) as Idea["category"],
            priority: String(form.get("priority")) as Idea["priority"],
            stage: String(form.get("stage")) as Idea["stage"],
          },
        },
        commandId,
      )
    )
      onClose();
  };
  return (
    <Modal
      title={id ? "Editar ideia" : "Registrar ideia"}
      subtitle="Capture agora. Organize quando for a hora de decidir."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="O que você quer lembrar?" wide>
            <input
              name="title"
              required
              minLength={2}
              maxLength={160}
              defaultValue={initial.title}
              autoFocus
              placeholder="Uma melhoria, problema ou oportunidade"
            />
          </Field>
          <Field label="Contexto e resultado esperado" wide>
            <textarea
              name="detail"
              rows={5}
              maxLength={10000}
              defaultValue={initial.detail}
              placeholder="Por que isso importa? O que você imaginou?"
            />
          </Field>
          <Field label="Área">
            <select name="category" defaultValue={initial.category}>
              {Object.entries(ideaCategories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioridade">
            <select name="priority" defaultValue={initial.priority}>
              {["P0", "P1", "P2", "P3"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Etapa" wide>
            <select name="stage" defaultValue={initial.stage}>
              {Object.entries(ideaStages).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-footer">
          {operationError && (
            <p className="form-error" role="alert">
              {operationError}
            </p>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" disabled={saving}>
            <Check size={16} />
            Salvar ideia
          </Button>
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Link2, RefreshCcw, Trash2 } from "lucide-react";
import { fullDate } from "@/lib/domain/dates";
import { mediaSize, type ProjectMedia } from "@/lib/media/contracts";
import { Badge, Button, Field, Modal } from "./ui";
import styles from "./media-intake.module.css";

type Action =
  { action: "status" | "rotate" | "revoke" } | { action: "remove"; id: string };
type Result =
  | { available: true; project: ProjectMedia; link?: string }
  | { available: false };

async function requestMedia(
  projectId: string,
  input: Action,
  signal?: AbortSignal,
): Promise<Result | null> {
  const response = await fetch("/api/media/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, projectId }),
    signal,
  });
  if (response.status === 401) {
    window.location.replace("/entrar?motivo=sessao");
    return null;
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "Não foi possível consultar as mídias.");
  return data;
}

export default function ProjectMediaDialog({
  projectId,
  projectName,
  canInvite,
  onClose,
}: {
  projectId: string;
  projectName: string;
  canInvite: boolean;
  onClose: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<Action["action"] | null>("status");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const load = useCallback(
    async (input: Action, signal?: AbortSignal) => {
      const { action } = input;
      setBusy(action);
      setError("");
      setRemoved(false);
      if (action !== "remove") setConfirmId(null);
      try {
        const data = await requestMedia(projectId, input, signal);
        if (!data) return;
        setResult(data);
        if (
          action === "rotate" ||
          action === "revoke" ||
          !data.available ||
          !data.project.expiresAt
        ) {
          setLink(data.available ? (data.link ?? "") : "");
          setCopied(false);
        }
        if (action === "remove") {
          setConfirmId(null);
          setRemoved(data.available);
        }
      } catch (failure) {
        if (signal?.aborted) return;
        if (action === "remove") {
          const latest = await requestMedia(projectId, {
            action: "status",
          }).catch(() => null);
          if (latest) setResult(latest);
          if (
            latest?.available &&
            !latest.project.files.some((file) => file.id === input.id)
          ) {
            setConfirmId(null);
            setRemoved(true);
            return;
          }
        }
        setError(
          failure instanceof Error
            ? failure.message
            : "O portal está indisponível.",
        );
      } finally {
        if (!signal?.aborted) setBusy(null);
      }
    },
    [projectId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load({ action: "status" }, controller.signal);
    return () => controller.abort();
  }, [load]);
  const project = result?.available ? result.project : null;

  return (
    <Modal title="Mídias VIP" subtitle={projectName} onClose={onClose} drawer>
      {project && (
        <>
          <div className="detail-actions">
            <Badge tone={project.expiresAt ? "green" : "neutral"}>
              {project.expiresAt
                ? `Convite ativo até ${fullDate(project.expiresAt)}`
                : "Sem convite ativo"}
            </Badge>
            <Button
              disabled={!!busy}
              onClick={() => void load({ action: "status" })}
            >
              <RefreshCcw size={15} /> Atualizar
            </Button>
          </div>
          <p className={styles.note}>
            O cliente recebe uma página exclusiva de envio. Os arquivos
            recebidos aparecem aqui.
          </p>
          <div className="button-group">
            {canInvite && (
              <Button
                variant="primary"
                disabled={!!busy}
                onClick={() => void load({ action: "rotate" })}
              >
                <Link2 size={16} />{" "}
                {project.expiresAt ? "Gerar novo link" : "Gerar link de envio"}
              </Button>
            )}
            {project.expiresAt && (
              <Button
                disabled={!!busy}
                onClick={() => void load({ action: "revoke" })}
              >
                Revogar link
              </Button>
            )}
          </div>
          {!canInvite && (
            <p className={styles.note}>
              Vincule um cliente a um projeto ativo para emitir um convite.
            </p>
          )}
          {canInvite && (
            <p className={styles.note}>
              O convite vale sete dias. Gerar um novo link encerra o convite
              anterior.
            </p>
          )}
          {link && (
            <div className="inline-note">
              <Field label="Link privado de envio">
                <input
                  readOnly
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </Field>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    setError(
                      "Selecione o link acima e copie pelo dispositivo.",
                    );
                  }
                }}
              >
                <Copy size={15} /> {copied ? "Link copiado" : "Copiar link"}
              </Button>
            </div>
          )}
          <div className="detail-section-heading">
            <h3>Arquivos recebidos</h3>
            <Badge>{project.files.length}</Badge>
          </div>
          <p className={styles.note}>
            {mediaSize(project.usedBytes)} reservados de 2 GB por projeto
            {project.pendingCount > 0
              ? ` · ${project.pendingCount} pendentes`
              : ""}
          </p>
          {removed && (
            <p className="inline-note" role="status">
              Arquivo removido.
            </p>
          )}
          {project.files.length ? (
            <ul className={`${styles.files} ${styles.projectFiles}`}>
              {project.files.map((file) => {
                const pending = project.removingIds?.includes(file.id);
                const confirming = confirmId === file.id;
                return (
                  <li key={file.id}>
                    <div className={styles.fileInfo}>
                      <strong>{file.fileName}</strong>
                      <small>
                        {mediaSize(file.sizeBytes)} ·{" "}
                        {fullDate(file.receivedAt)}
                      </small>
                      {pending && <small>Remoção pendente</small>}
                    </div>
                    {!confirming && (
                      <div className={styles.fileActions}>
                        {!pending && (
                          <a
                            className="button button-secondary"
                            href={`/api/media/download?projectId=${projectId}&id=${file.id}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Baixar ${file.fileName}`}
                          >
                            <Download size={15} /> Baixar
                          </a>
                        )}
                        {project.removingIds && (
                          <Button
                            variant="ghost"
                            disabled={!!busy}
                            aria-label={`${pending ? "Concluir remoção de" : "Remover"} ${file.fileName}`}
                            onClick={() => {
                              setConfirmId(file.id);
                              setError("");
                              setRemoved(false);
                            }}
                          >
                            <Trash2 size={15} />{" "}
                            {pending ? "Concluir remoção" : "Remover"}
                          </Button>
                        )}
                      </div>
                    )}
                    {confirming && (
                      <div className={styles.fileConfirmation}>
                        <p>
                          Remover este arquivo do projeto? A remoção é
                          permanente.
                        </p>
                        {error && (
                          <p className="form-error" role="alert">
                            {error}
                          </p>
                        )}
                        <div className="button-group">
                          <Button
                            disabled={!!busy}
                            onClick={() => {
                              setConfirmId(null);
                              setError("");
                            }}
                          >
                            Cancelar
                          </Button>
                          <Button
                            variant="danger"
                            disabled={!!busy}
                            onClick={() =>
                              void load({ action: "remove", id: file.id })
                            }
                          >
                            {busy === "remove"
                              ? "Removendo…"
                              : "Confirmar remoção"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.note}>
              Os arquivos confirmados aparecerão nesta lista.
            </p>
          )}
        </>
      )}
      {result?.available === false && (
        <p className="inline-note">
          Aguardando a conexão com o armazenamento privado da Área VIP.
        </p>
      )}
      {busy === "status" && !result && <p role="status">Carregando mídias…</p>}
      {error && !project?.files.some((file) => file.id === confirmId) && (
        <div className="form-footer">
          <p className="form-error" role="alert">
            {error}
          </p>
          {!result && (
            <Button
              disabled={!!busy}
              onClick={() => void load({ action: "status" })}
            >
              Tentar novamente
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Link2, RefreshCcw } from "lucide-react";
import { fullDate } from "@/lib/domain/dates";
import { mediaSize, type ProjectMedia } from "@/lib/media/contracts";
import { Badge, Button, Field, Modal } from "./ui";
import styles from "./media-intake.module.css";

type Action = "status" | "rotate" | "revoke";
type Result =
  | { available: true; project: ProjectMedia; link?: string }
  | { available: false };

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
  const [busy, setBusy] = useState<Action | null>("status");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const load = useCallback(
    async (action: Action, signal?: AbortSignal) => {
      setBusy(action);
      setError("");
      try {
        const response = await fetch("/api/media/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, projectId }),
          signal,
        });
        if (response.status === 401) {
          window.location.replace("/entrar?motivo=sessao");
          return;
        }
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error ?? "Não foi possível consultar as mídias.",
          );
        setResult(data);
        if (action !== "status" || !data.project?.expiresAt) {
          setLink(data.link ?? "");
          setCopied(false);
        }
      } catch (failure) {
        if (!signal?.aborted)
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
    void load("status", controller.signal);
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
            <Button disabled={!!busy} onClick={() => void load("status")}>
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
                onClick={() => void load("rotate")}
              >
                <Link2 size={16} />{" "}
                {project.expiresAt ? "Gerar novo link" : "Gerar link de envio"}
              </Button>
            )}
            {project.expiresAt && (
              <Button disabled={!!busy} onClick={() => void load("revoke")}>
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
          {project.files.length ? (
            <ul className={styles.files}>
              {project.files.map((file) => (
                <li key={file.id}>
                  <div>
                    <strong>{file.fileName}</strong>
                    <small>
                      {mediaSize(file.sizeBytes)} · {fullDate(file.receivedAt)}
                    </small>
                  </div>
                  <a
                    className="button button-secondary"
                    href={`/api/media/download?projectId=${projectId}&id=${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Baixar ${file.fileName}`}
                  >
                    <Download size={15} /> Baixar
                  </a>
                </li>
              ))}
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
      {error && (
        <div className="form-footer">
          <p className="form-error" role="alert">
            {error}
          </p>
          {!result && (
            <Button disabled={!!busy} onClick={() => void load("status")}>
              Tentar novamente
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

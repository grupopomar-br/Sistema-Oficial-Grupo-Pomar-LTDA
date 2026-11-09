"use client";

import { useEffect, useState } from "react";
import { Check, CloudUpload, FileImage, X } from "lucide-react";
import {
  mediaAccept,
  mediaSize,
  mediaTokenPattern,
  metadataForFile,
  type MediaMetadata,
  type MediaRequest,
} from "@/lib/media/contracts";
import { fullDate } from "@/lib/domain/dates";
import { newId } from "@/lib/domain/id";
import { BrandLogo } from "./brand-logo";
import { Button, IconButton } from "./ui";
import styles from "./media-intake.module.css";

type Upload = {
  id: string;
  file: File;
  metadata: MediaMetadata;
  progress: number;
  state: "queued" | "sending" | "checking" | "received" | "error";
  error?: string;
};

async function requestMedia(input: MediaRequest, signal?: AbortSignal) {
  const response = await fetch("/api/envio-vip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
    credentials: "omit",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Envio indisponível.");
  return data;
}

function sendToStorage(
  ticket: { url: string; headers: Record<string, string> },
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.url);
    for (const [name, value] of Object.entries(ticket.headers))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.floor((100 * event.loaded) / event.total));
    };
    request.onload = () => {
      if (
        (request.status >= 200 && request.status < 300) ||
        request.status === 412
      )
        resolve();
      else
        reject(new Error("O armazenamento recusou o envio. Tente novamente."));
    };
    request.onerror = request.onabort = () =>
      reject(
        new Error(
          "O envio foi interrompido. Confira a conexão e tente novamente.",
        ),
      );
    request.send(file);
  });
}

const statusLabels = {
  queued: "Na fila",
  sending: "Enviando",
  checking: "Conferindo arquivo",
  received: "Recebido",
  error: "Envio pendente",
} as const;

export default function MediaIntake() {
  const [access, setAccess] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [status, setStatus] = useState("Conferindo o convite…");
  const [files, setFiles] = useState<Upload[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!mediaTokenPattern.test(token)) {
      setStatus("Abra o link de envio recebido do Grupo Pomar.");
      return;
    }
    const controller = new AbortController();
    void requestMedia({ action: "status", token }, controller.signal)
      .then((data) => setAccess({ token, expiresAt: data.expiresAt }))
      .catch((failure) => {
        if (!controller.signal.aborted)
          setStatus(
            failure instanceof Error
              ? failure.message
              : "Convite indisponível.",
          );
      });
    return () => controller.abort();
  }, []);

  const pending = files.filter((file) => file.state !== "received");
  const update = (id: string, patch: Partial<Upload>) =>
    setFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, ...patch } : file)),
    );

  const select = (list: FileList | null) => {
    if (!list?.length) return;
    setError("");
    if (list.length + pending.length > 20) {
      setError("Selecione até 20 arquivos por vez.");
      return;
    }
    const accepted: Upload[] = [];
    for (const file of Array.from(list)) {
      try {
        accepted.push({
          id: newId(),
          file,
          metadata: metadataForFile(file),
          progress: 0,
          state: "queued",
        });
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Arquivo incompatível.",
        );
      }
    }
    setFiles((current) => [...current, ...accepted]);
  };

  const send = async () => {
    if (!access || sending || !pending.length) return;
    setSending(true);
    setError("");
    for (const upload of pending) {
      const { id, metadata } = upload;
      update(id, { progress: 0, state: "sending", error: undefined });
      try {
        const ticket = await requestMedia({
          action: "reserve",
          token: access.token,
          id,
          file: metadata,
        });
        if (ticket.received !== true) {
          await sendToStorage(ticket, upload.file, (progress) =>
            update(id, { progress }),
          );
          update(id, { progress: 100, state: "checking" });
          await requestMedia({ action: "confirm", token: access.token, id });
        }
        update(id, { progress: 100, state: "received" });
      } catch (failure) {
        update(id, {
          state: "error",
          error:
            failure instanceof Error ? failure.message : "Tente novamente.",
        });
      }
    }
    setSending(false);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandLogo theme="light" />
        <span>ÁREA VIP</span>
      </header>
      <section className={styles.card} aria-labelledby="media-title">
        <div className={styles.intro}>
          <CloudUpload size={27} />
          <span className="eyebrow">MÍDIAS DO PROJETO</span>
          <h1 id="media-title">Envie suas fotos e vídeos.</h1>
          <p>Selecione os originais que vamos usar no seu projeto.</p>
        </div>
        {access ? (
          <>
            <p className={styles.note}>
              Convite válido até {fullDate(access.expiresAt)}.
            </p>
            <label className={styles.chooser}>
              <span>Selecionar arquivos</span>
              <input
                type="file"
                accept={mediaAccept}
                multiple
                disabled={sending}
                onChange={(event) => {
                  select(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <p className={styles.note}>
              PNG, JPG, HEIC e WebP até 30 MB. MP4, MOV e WebM até 500 MB por
              arquivo.
            </p>
            {files.length > 0 && (
              <ul className={styles.files}>
                {files.map((file) => (
                  <li key={file.id}>
                    {file.state === "received" ? (
                      <Check size={17} />
                    ) : (
                      <FileImage size={17} />
                    )}
                    <div>
                      <strong>{file.metadata.fileName}</strong>
                      <small>
                        {mediaSize(file.metadata.sizeBytes)} ·{" "}
                        {statusLabels[file.state]}
                      </small>
                      {["sending", "checking"].includes(file.state) && (
                        <progress
                          max={100}
                          value={file.progress}
                          aria-label={`Envio de ${file.metadata.fileName}`}
                        />
                      )}
                      {file.error && (
                        <p className="form-error" role="alert">
                          {file.error}
                        </p>
                      )}
                    </div>
                    {file.state !== "received" && (
                      <IconButton
                        label={`Remover ${file.metadata.fileName} da seleção`}
                        disabled={sending}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((item) => item.id !== file.id),
                          )
                        }
                      >
                        <X size={16} />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              className={styles.send}
              variant="primary"
              disabled={sending || !pending.length}
              onClick={() => void send()}
            >
              <CloudUpload size={16} />
              {sending
                ? "Enviando mídias…"
                : pending.some((file) => file.state === "error")
                  ? "Tentar envios pendentes"
                  : "Enviar mídias"}
            </Button>
            {files.length > 0 && !pending.length && (
              <p className={styles.note} role="status">
                Todos os arquivos desta seleção foram recebidos.
              </p>
            )}
          </>
        ) : (
          <p className={styles.note} role="status">
            {status}
          </p>
        )}
      </section>
    </main>
  );
}

"use client";
import { useRef, useState, type FormEvent } from "react";
import {
  Download,
  Upload,
  Shield,
  Database,
  Plus,
  Check,
  FlaskConical,
  Lock,
  ArrowUpRight,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, Field, Modal, SectionHeading } from "../ui";
import type { ViewProps } from "../types";
import { exportBackup, importBackup } from "@/lib/domain/backup";
import { demonstrationWorkspace } from "@/lib/domain/demo";
import { newBase, type Area, type Workspace } from "@/lib/domain/model";
import { downloadFile } from "./finance";

export default function Settings({ today }: ViewProps) {
  const { state, mode, execute, replaceLocal, saving, operationError } =
    useWorkspace();
  const [preferencesRevision, setPreferencesRevision] = useState(
    state.revision,
  );
  const [fileError, setFileError] = useState("");
  const [pending, setPending] = useState<Workspace | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await execute({
      type: "saveSettings",
      expectedRevision: preferencesRevision,
      value: {
        businessName: String(form.get("businessName")),
        displayName: String(form.get("displayName")),
        dailyFocusLimit: Number(form.get("dailyFocusLimit")),
        staleDays: Number(form.get("staleDays")),
      },
    });
    if (saved) setPreferencesRevision(preferencesRevision + 1);
  };
  const readFile = async (selected: File | undefined) => {
    if (!selected) return;
    setFileError("");
    try {
      if (selected.size > 5 * 1024 * 1024)
        throw new Error("O arquivo excede o limite de 5 MB.");
      const data = importBackup(await selected.text());
      setPending(data);
      setConfirm(false);
    } catch {
      setFileError(
        "O arquivo não é um backup válido desta versão ou contém vínculos/valores inconsistentes.",
      );
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const empty =
    !state.clients.length &&
    !state.projects.length &&
    !state.tasks.length &&
    !state.contracts.length &&
    !state.expenses.length &&
    !state.opportunities.length;
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>A estrutura por trás da sua rotina.</h2>
          <p>Preferências, áreas e continuidade do trabalho.</p>
        </div>
        <Badge tone={mode === "cloud" ? "green" : "amber"}>
          {mode === "cloud"
            ? "Conectado ao Supabase"
            : "Espaço local de desenvolvimento"}
        </Badge>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <SectionHeading title="Sua operação" eyebrow="PREFERÊNCIAS" />
          <form onSubmit={savePreferences}>
            <div className="form-grid">
              <Field label="Nome da empresa" wide>
                <input
                  name="businessName"
                  defaultValue={state.settings.businessName}
                  minLength={2}
                  maxLength={160}
                  required
                />
              </Field>
              <Field label="Como você prefere ser chamado" wide>
                <input
                  name="displayName"
                  defaultValue={state.settings.displayName}
                  maxLength={60}
                  required
                />
              </Field>
              <Field label="Ações no comando do dia">
                <select
                  name="dailyFocusLimit"
                  defaultValue={state.settings.dailyFocusLimit}
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value} ações
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Revisar projetos sem atualização">
                <select
                  name="staleDays"
                  defaultValue={state.settings.staleDays}
                >
                  {[3, 5, 7, 10, 15, 30, 60, 90].map((value) => (
                    <option key={value} value={value}>
                      {value} dias
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="form-footer">
              <Button variant="primary" type="submit" disabled={saving}>
                <Check size={16} />
                Salvar preferências
              </Button>
            </div>
          </form>
        </section>
        <section className="panel settings-panel">
          <SectionHeading title="Continuidade dos dados" eyebrow="BACKUP" />
          <div className="backup-description">
            <span className="list-icon">
              <Database size={22} />
            </span>
            <p>
              {mode === "local"
                ? "Os registros deste espaço ficam neste navegador. Exporte uma cópia para manter a continuidade entre dispositivos."
                : "Os dados são consultados do Supabase. A exportação abaixo é uma cópia dos registros carregados; o backup completo do banco é administrado separadamente."}
            </p>
          </div>
          <div className="button-group">
            <Button
              variant="primary"
              onClick={() =>
                downloadFile(
                  `pomar-backup-${today}.json`,
                  exportBackup(state),
                  "application/json",
                )
              }
            >
              <Download size={16} />
              Exportar backup JSON
            </Button>
            {mode === "local" && (
              <Button onClick={() => file.current?.click()}>
                <Upload size={16} />
                Restaurar backup
              </Button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Selecionar backup JSON"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
          {fileError && (
            <p className="form-error" role="alert">
              {fileError}
            </p>
          )}
          <div className="security-note">
            <Shield size={17} />
            <p>
              O backup contém informações da sua operação. Guarde-o em um local
              privado e protegido.
            </p>
          </div>
        </section>
      </div>
      <section className="panel settings-panel">
        <SectionHeading title="Frentes da operação" eyebrow="ORGANIZAÇÃO">
          <Button
            onClick={() =>
              setArea({
                ...newBase(),
                name: "",
                color: "green",
                archived: false,
              })
            }
          >
            <Plus size={16} />
            Nova área
          </Button>
        </SectionHeading>
        <div className="areas-settings">
          {state.areas.map((item) => (
            <button type="button" key={item.id} onClick={() => setArea(item)}>
              <span className={`area-dot dot-${item.color}`} />
              <strong>{item.name}</strong>
              <Badge tone={item.archived ? "neutral" : item.color}>
                {item.archived
                  ? "Arquivada"
                  : `${state.projects.filter((project) => project.areaId === item.id).length} projetos`}
              </Badge>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <SectionHeading
          title="Acesso exclusivo do proprietário"
          eyebrow="SEGURANÇA"
        />
        <div className="security-description">
          <span className="list-icon">
            <Lock size={21} />
          </span>
          <div>
            <h3>
              {mode === "cloud"
                ? "Sessão com autenticação e segundo fator"
                : "Autenticação da nuvem ainda não ativada neste espaço"}
            </h3>
            <p>
              {mode === "cloud"
                ? "O acesso é verificado no servidor e nas políticas do banco. Não há cadastro público de usuários."
                : "Este é o ambiente local de desenvolvimento. O login exclusivo e a autenticação de dois fatores serão utilizados ao conectar o Supabase."}
            </p>
          </div>
          {mode === "cloud" && (
            <a className="button button-secondary" href="/seguranca">
              Ver segurança
              <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </section>
      {mode === "local" && empty && (
        <section className="demo-card">
          <FlaskConical size={25} />
          <div>
            <h3>Conheça a operação com exemplos.</h3>
            <p>
              Carregue registros fictícios para explorar os fluxos. Disponível
              somente no espaço local vazio.
            </p>
          </div>
          <Button
            onClick={() => void replaceLocal(demonstrationWorkspace())}
            disabled={saving}
          >
            Carregar exemplos
          </Button>
        </section>
      )}
      {area && (
        <Modal
          title={area.name ? "Editar área" : "Nova área"}
          onClose={() => setArea(null)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              if (
                await execute({
                  type: "saveArea",
                  value: {
                    ...area,
                    name: String(form.get("name")),
                    color: String(form.get("color")) as Area["color"],
                    archived: form.has("archived"),
                  },
                })
              )
                setArea(null);
            }}
          >
            <div className="form-grid">
              <Field label="Nome da área" wide>
                <input
                  name="name"
                  defaultValue={area.name}
                  minLength={2}
                  maxLength={160}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Cor">
                <select name="color" defaultValue={area.color}>
                  <option value="green">Verde</option>
                  <option value="amber">Âmbar</option>
                  <option value="violet">Violeta</option>
                  <option value="blue">Azul</option>
                </select>
              </Field>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="archived"
                  defaultChecked={area.archived}
                />
                <span>Arquivar área</span>
              </label>
            </div>
            <div className="form-footer">
              {operationError && (
                <p className="form-error" role="alert">
                  {operationError}
                </p>
              )}
              <Button onClick={() => setArea(null)}>Cancelar</Button>
              <Button variant="primary" type="submit" disabled={saving}>
                Salvar área
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {pending && (
        <Modal
          title="Conferir restauração de backup"
          onClose={() => setPending(null)}
        >
          <div className="import-summary">
            <div>
              <strong>{pending.clients.length}</strong>
              <span>clientes</span>
            </div>
            <div>
              <strong>{pending.projects.length}</strong>
              <span>projetos</span>
            </div>
            <div>
              <strong>{pending.tasks.length}</strong>
              <span>tarefas</span>
            </div>
            <div>
              <strong>{pending.receipts.length}</strong>
              <span>recebimentos</span>
            </div>
          </div>
          <div className="inline-note inline-note-warning">
            A restauração substitui os registros deste espaço local. Exporte o
            backup atual antes de confirmar.
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(event) => setConfirm(event.target.checked)}
            />
            <span>
              Conferi o arquivo e autorizo substituir este espaço local.
            </span>
          </label>
          <div className="form-footer">
            <Button onClick={() => setPending(null)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!confirm || saving}
              onClick={async () => {
                if (await replaceLocal(pending)) setPending(null);
              }}
            >
              Restaurar registros
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

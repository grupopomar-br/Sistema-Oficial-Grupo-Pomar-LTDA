import type { Workspace } from "@/lib/domain/model";

export type View =
  | "collections"
  | "ideas"
  | "overview"
  | "projects"
  | "tasks"
  | "clients"
  | "finance"
  | "commercial"
  | "alerts"
  | "history"
  | "settings";
export type ModalState =
  | { kind: "idea"; id?: string }
  | { kind: "client"; id?: string }
  | { kind: "project"; id?: string }
  | { kind: "task"; id?: string; projectId?: string }
  | { kind: "contract"; projectId?: string }
  | { kind: "expense"; id?: string }
  | { kind: "opportunity"; id?: string }
  | { kind: "receipt"; installmentId: string }
  | { kind: "dateReceipt"; id: string }
  | { kind: "voidReceipt"; id: string }
  | { kind: "cancelContract"; id: string }
  | { kind: "note"; projectId: string }
  | { kind: "convert"; id: string }
  | { kind: "projectDetail"; id: string }
  | { kind: "clientDetail"; id: string }
  | { kind: "import"; workspace: Workspace }
  | { kind: "search" };
export type ViewProps = {
  open: (modal: ModalState) => void;
  navigate: (view: View) => void;
  hiddenValues: boolean;
  today: string;
  month: string;
  setMonth: (month: string) => void;
};

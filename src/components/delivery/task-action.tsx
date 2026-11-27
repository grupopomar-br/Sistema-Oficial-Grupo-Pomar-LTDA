"use client";
import { Check, ClipboardCheck } from "lucide-react";
import type { Task } from "@/lib/domain/model";
import { isTaskClosed } from "@/lib/domain/delivery/schema";
import { deliveryIndex } from "@/lib/domain/delivery/selectors";
import { useWorkspace } from "../workspace-provider";
import type { ModalState } from "../types";

export function TaskAction({
  task,
  open,
}: {
  task: Task;
  open: (modal: ModalState) => void;
}) {
  const { state, saving, execute } = useWorkspace();
  const managed = deliveryIndex(state).items.has(task.id);
  const closed = isTaskClosed(task);
  return (
    <button
      type="button"
      className={`task-check ${closed ? "checked" : ""}`}
      aria-label={`${managed ? "Conferir entrega" : closed ? "Reabrir" : "Concluir"} ${task.title}`}
      disabled={saving}
      onClick={() =>
        managed
          ? open({ kind: "deliveryTask", id: task.id })
          : void execute({
              type: "setTaskStatus",
              id: task.id,
              status: closed ? "pending" : "done",
              expectedVersion: task.version,
            })
      }
    >
      {managed ? (
        <ClipboardCheck size={15} />
      ) : closed ? (
        <Check size={15} />
      ) : null}
    </button>
  );
}

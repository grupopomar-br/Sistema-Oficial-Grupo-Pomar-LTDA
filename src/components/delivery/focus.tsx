"use client";
import { useMemo } from "react";
import { useWorkspace } from "../workspace-provider";
import { Button } from "../ui";
import type { ViewProps } from "../types";
import { deliveryQueue } from "@/lib/domain/delivery/selectors";
import { isTaskClosed } from "@/lib/domain/delivery/schema";
import { DeliveryRow } from "./item-row";
import styles from "./delivery.module.css";

export function DeliveryFocus({
  open,
  navigate,
  today,
}: Pick<ViewProps, "open" | "navigate" | "today">) {
  const { state } = useWorkspace();
  const queue = useMemo(
    () => deliveryQueue(state, today).filter((row) => !isTaskClosed(row.task)),
    [state, today],
  );
  if (!queue.length) return null;
  const actionable = queue.filter(
    (row) => !row.upcoming && (row.ready || row.task.status !== "pending"),
  );
  return (
    <section className="panel" aria-label="Entregas contratuais prioritárias">
      <div className="panel-heading">
        <div>
          <h2>Entregas dos clientes</h2>
          <p>
            {queue.filter((row) => row.late).length} vencidas ·{" "}
            {queue.filter((row) => row.task.status === "waiting_client").length}{" "}
            aguardando cliente ·{" "}
            {queue.filter((row) => row.task.status === "review").length} para
            validar
          </p>
        </div>
        <Button onClick={() => navigate("deliveries")}>Abrir Entregas</Button>
      </div>
      <ul className={styles.list}>
        {(actionable.length ? actionable : queue)
          .slice(0, 3)
          .map(({ task, item, project }) => (
            <DeliveryRow
              key={task.id}
              task={task}
              item={item}
              today={today}
              open={open}
              context={project.name}
            />
          ))}
      </ul>
    </section>
  );
}

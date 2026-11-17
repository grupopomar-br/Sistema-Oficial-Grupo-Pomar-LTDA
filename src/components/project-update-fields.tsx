"use client";

import { useId, useState } from "react";
import { Button, Field } from "./ui";
import type { Project } from "@/lib/domain/model";
import styles from "./project-meter.module.css";

export function ProjectUpdateFields({
  project,
  progress,
}: {
  project: Project;
  progress: number;
}) {
  const progressId = useId();
  const [measurement, setMeasurement] = useState<number | null>(null);
  const percent = measurement ?? progress;
  return (
    <>
      <div className={styles.field}>
        <div className={styles.fieldHeader}>
          <label htmlFor={progressId}>Avanço da entrega</label>
          <output htmlFor={progressId}>{percent}%</output>
        </div>
        <input
          id={progressId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-valuetext={`${percent}%`}
          onChange={(event) =>
            setMeasurement(event.currentTarget.valueAsNumber)
          }
        />
        <input type="hidden" name="progressPercent" value={measurement ?? ""} />
        <div className={styles.fieldFooter}>
          <small>
            {measurement === null
              ? "Ajuste o avanço se a entrega evoluiu."
              : `Anterior ${progress}%`}
          </small>
          <Button
            disabled={percent === 100}
            onClick={() => setMeasurement(Math.min(100, percent + 10))}
          >
            +10 pontos
          </Button>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Próxima ação">
          <input
            name="nextAction"
            maxLength={1000}
            defaultValue={project.nextAction}
            placeholder="Ex. Validar a entrega com o cliente"
          />
        </Field>
        <Field label="Data da próxima ação">
          <input
            type="date"
            name="nextActionOn"
            defaultValue={(project.nextAction && project.nextActionOn) || ""}
          />
        </Field>
      </div>
    </>
  );
}

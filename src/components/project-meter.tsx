import styles from "./project-meter.module.css";

export function ProjectMeter({
  percent,
  label = "Avanço",
}: {
  percent: number;
  label?: string;
}) {
  return (
    <div className={styles.meter}>
      <div className={styles.readout}>
        <span>{label}</span>
        <strong>{percent}%</strong>
      </div>
      <progress max={100} value={percent} aria-label={label} />
    </div>
  );
}

export function updateCountLabel(count: number) {
  return `${count} ${count === 1 ? "atualização" : "atualizações"}`;
}

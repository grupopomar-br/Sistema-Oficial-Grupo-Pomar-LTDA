export function isDateOnly(value: string): boolean {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))
    return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function todayDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

export function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-15T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function addMonthsClamped(date: string, offset: number): string {
  if (!isDateOnly(date)) throw new Error("Data inválida.");
  const month = shiftMonth(date.slice(0, 7), offset);
  const firstNextMonth = new Date(`${shiftMonth(month, 1)}-01T12:00:00Z`);
  firstNextMonth.setUTCDate(0);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), firstNextMonth.getUTCDate())).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T12:00:00Z`).valueOf() -
      new Date(`${from}T12:00:00Z`).valueOf()) /
      86_400_000,
  );
}

export function projectDurationLabel(
  project: {
    startedOn: string | null;
    completedOn?: string | null;
    status: string;
  },
  today: string,
): string {
  if (!project.startedOn) return "Início não informado";
  if (project.status === "cancelled") return "Projeto cancelado";
  if (project.status === "completed" && !project.completedOn)
    return "Conclusão sem data registrada";
  const end = project.status === "completed" ? project.completedOn! : today;
  const days = daysBetween(project.startedOn, end);
  if (days < 0 && project.status === "completed")
    return "Datas do projeto inconsistentes";
  if (days < 0) return `Início em ${-days} ${days === -1 ? "dia" : "dias"}`;
  if (project.status === "completed")
    return days === 0
      ? "Concluído no mesmo dia"
      : `${days} ${days === 1 ? "dia corrido" : "dias corridos"} até a conclusão`;
  return days === 0
    ? "Início hoje"
    : `${days} ${days === 1 ? "dia corrido" : "dias corridos"} desde o início`;
}

export function shortDate(value: string | null): string {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "short",
  }).format(new Date(value.length > 10 ? value : `${value}T12:00:00Z`));
}

export function fullDate(value: string | null): string {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value.length > 10 ? value : `${value}T12:00:00Z`));
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-15T12:00:00Z`));
}

export function money(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

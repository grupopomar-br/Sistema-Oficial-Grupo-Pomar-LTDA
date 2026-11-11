import type { Command } from "./model.ts";
export function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        camelize(item),
      ]),
    );
  return value;
}
export function databaseCommand(command: unknown): unknown {
  // Completion and removal are controlled by their database transitions.
  if (
    command &&
    typeof command === "object" &&
    "type" in command &&
    command.type === "saveProject" &&
    "value" in command &&
    command.value &&
    typeof command.value === "object" &&
    !Array.isArray(command.value)
  ) {
    const {
      completedOn: _completedOn,
      removedAt: _removedAt,
      ...value
    } = command.value as Record<string, unknown>;
    command = { ...command, value };
  }
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
          convert(item),
        ]),
      );
    return value;
  };
  return convert(command);
}

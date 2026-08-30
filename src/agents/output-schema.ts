function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripOutputSchemaFormats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOutputSchemaFormats);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "format")
      .map(([key, entry]) => [key, stripOutputSchemaFormats(entry)]),
  );
}

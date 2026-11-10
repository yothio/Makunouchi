type LogLevel = "info" | "warn" | "error";

/** One JSON line per event so Workers Logs can filter by field. */
export const logEvent = (level: LogLevel, event: string, fields: Record<string, unknown> = {}): void => {
  // Logging must not abort host transitions or other DO work if stringify/console throws.
  try {
    const line = JSON.stringify({ level, event, ...fields });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
  }
};

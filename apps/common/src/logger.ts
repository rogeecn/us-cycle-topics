type LogLevel = "info" | "warn" | "error";

export interface LogMeta {
  [key: string]: unknown;
}

function stringify(meta?: LogMeta): string {
  if (!meta) {
    return "";
  }
  return ` ${JSON.stringify(meta)}`;
}

function emit(level: LogLevel, message: string, meta?: LogMeta): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${stringify(meta)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    emit("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    emit("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    emit("error", message, meta);
  },
};

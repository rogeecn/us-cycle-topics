function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractNodeNetworkMeta(error: Record<string, unknown>): string {
  const code = typeof error.code === "string" ? error.code : undefined;
  const syscall = typeof error.syscall === "string" ? error.syscall : undefined;
  const address = typeof error.address === "string" ? error.address : undefined;
  const port =
    typeof error.port === "number" || typeof error.port === "string"
      ? String(error.port)
      : undefined;

  const segments: string[] = [];
  if (code) {
    segments.push(`code=${code}`);
  }
  if (syscall) {
    segments.push(`syscall=${syscall}`);
  }
  if (address) {
    segments.push(`address=${address}`);
  }
  if (port) {
    segments.push(`port=${port}`);
  }

  return segments.join(", ");
}

function normalizeAggregateError(error: AggregateError): string {
  const items = Array.from(error.errors ?? []);
  if (items.length === 0) {
    return "AggregateError: no inner errors";
  }

  const parts = items.map((item, index) => {
    const normalized = normalizeError(item);
    return `#${index + 1} ${normalized}`;
  });

  return `AggregateError: ${parts.join(" | ")}`;
}

export function normalizeError(error: unknown): string {
  if (error === undefined || error === null) {
    return "unknown error";
  }

  if (error instanceof AggregateError) {
    return normalizeAggregateError(error);
  }

  if (error instanceof Error) {
    const message = error.message?.trim();
    const meta = isObject(error) ? extractNodeNetworkMeta(error) : "";

    if (message && meta) {
      return `${message} (${meta})`;
    }
    if (message) {
      return message;
    }

    if (error.cause !== undefined && error.cause !== null) {
      const fromCause = normalizeError(error.cause);
      if (fromCause && fromCause !== "unknown error") {
        return fromCause;
      }
    }

    if (meta) {
      return `${error.name || "Error"} (${meta})`;
    }

    return error.name || "UnknownError";
  }

  if (typeof error === "string") {
    return error;
  }

  if (isObject(error)) {
    const meta = extractNodeNetworkMeta(error);
    if (meta) {
      return meta;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "UnknownObjectError";
    }
  }

  return String(error);
}

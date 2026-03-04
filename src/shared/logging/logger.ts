import { getCorrelationId } from "./correlation-id.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMetadata = Record<string, unknown>;

export interface Logger {
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
  child: (bindings: LogMetadata) => Logger;
}

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  metadata?: LogMetadata;
}

interface LoggerOptions {
  minLevel?: LogLevel;
  environment?: string;
  sink?: (line: string, record: LogRecord) => void;
  getCorrelationId?: () => string | undefined;
  bindings?: LogMetadata;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const toSerializable = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = toSerializable(entry, seen);
  }
  return output;
};

const sanitizeMetadata = (metadata: LogMetadata): LogMetadata => {
  const seen = new WeakSet<object>();
  return toSerializable(metadata, seen) as LogMetadata;
};

const defaultSink = (line: string, record: LogRecord): void => {
  const stream = record.level === "warn" || record.level === "error" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

const mergeMetadata = (bindings?: LogMetadata, metadata?: LogMetadata): LogMetadata | undefined => {
  if (!bindings && !metadata) return undefined;
  const merged: LogMetadata = {
    ...(bindings || {}),
    ...(metadata || {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const formatDevelopmentLine = (record: LogRecord): string => {
  const level = record.level.toUpperCase().padEnd(5, " ");
  const correlation = record.correlationId ? ` [cid:${record.correlationId}]` : "";
  const metadata = record.metadata ? ` ${JSON.stringify(record.metadata)}` : "";
  return `${record.timestamp} ${level}${correlation} ${record.message}${metadata}`;
};

const formatProductionLine = (record: LogRecord): string => JSON.stringify(record);

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const minLevel: LogLevel = options.minLevel ?? (environment === "production" ? "info" : "debug");
  const sink = options.sink ?? defaultSink;
  const correlationIdResolver = options.getCorrelationId ?? getCorrelationId;
  const bindings = options.bindings;

  const log = (level: LogLevel, message: string, metadata?: LogMetadata): void => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) {
      return;
    }

    const mergedMetadata = mergeMetadata(bindings, metadata);
    const correlationId = correlationIdResolver();
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (correlationId) {
      record.correlationId = correlationId;
    }

    if (mergedMetadata) {
      record.metadata = sanitizeMetadata(mergedMetadata);
    }

    const line = environment === "production" ? formatProductionLine(record) : formatDevelopmentLine(record);
    sink(line, record);
  };

  return {
    debug: (message, metadata) => log("debug", message, metadata),
    info: (message, metadata) => log("info", message, metadata),
    warn: (message, metadata) => log("warn", message, metadata),
    error: (message, metadata) => log("error", message, metadata),
    child: (childBindings) =>
      createLogger({
        ...options,
        environment,
        minLevel,
        sink,
        getCorrelationId: correlationIdResolver,
        bindings: mergeMetadata(bindings, childBindings),
      }),
  };
};

export const createNoopLogger = (): Logger => {
  const noopLogger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => noopLogger,
  };
  return noopLogger;
};


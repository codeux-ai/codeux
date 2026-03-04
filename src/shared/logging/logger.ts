import { inspect } from "util";
import { getCorrelationId } from "./correlation-id.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogMetadata {
  [key: string]: unknown;
}

export interface Logger {
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
  child: (bindings: LogMetadata) => Logger;
}

interface StructuredLoggerOptions {
  level?: LogLevel;
  environment?: "development" | "production";
  bindings?: LogMetadata;
}

interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  metadata?: LogMetadata;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const normalizeLevel = (level: string | undefined): LogLevel => {
  const normalized = level?.toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
};

const normalizeMetadataValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeMetadataValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeMetadataValue(item)])
    );
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
};

const normalizeMetadata = (metadata: LogMetadata | undefined): LogMetadata | undefined => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }
  return normalizeMetadataValue(metadata) as LogMetadata;
};

const serializeForJson = (record: StructuredLogRecord): string => {
  return JSON.stringify(record);
};

const formatMetadataForDevelopment = (metadata: LogMetadata | undefined): string => {
  if (!metadata) {
    return "";
  }
  return ` ${inspect(metadata, {
    depth: 5,
    colors: false,
    compact: true,
    breakLength: 140,
  })}`;
};

const serializeForDevelopment = (record: StructuredLogRecord): string => {
  const levelLabel = record.level.toUpperCase();
  const correlationSegment = record.correlationId ? ` [correlationId=${record.correlationId}]` : "";
  return `${record.timestamp} ${levelLabel}${correlationSegment} ${record.message}${formatMetadataForDevelopment(record.metadata)}`;
};

export const createLogger = (options: StructuredLoggerOptions = {}): Logger => {
  const minLevel = options.level ?? normalizeLevel(process.env.LOG_LEVEL);
  const environment = options.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const bindings = { ...(options.bindings || {}) };

  const shouldLog = (level: LogLevel): boolean => LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];

  const write = (level: LogLevel, text: string): void => {
    if (level === "error") {
      console.error(text);
      return;
    }
    if (level === "warn") {
      console.warn(text);
      return;
    }
    if (level === "debug") {
      console.debug(text);
      return;
    }
    console.info(text);
  };

  const log = (level: LogLevel, message: string, metadata?: LogMetadata): void => {
    if (!shouldLog(level)) {
      return;
    }

    const correlationId = getCorrelationId();
    const normalizedBindings = normalizeMetadata(bindings);
    const normalizedMetadata = normalizeMetadata(metadata);
    const mergedMetadata = normalizedBindings || normalizedMetadata
      ? {
          ...(normalizedBindings || {}),
          ...(normalizedMetadata || {}),
        }
      : undefined;

    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (correlationId) {
      record.correlationId = correlationId;
    }
    if (mergedMetadata && Object.keys(mergedMetadata).length > 0) {
      record.metadata = mergedMetadata;
    }

    const serialized = environment === "production"
      ? serializeForJson(record)
      : serializeForDevelopment(record);
    write(level, serialized);
  };

  return {
    debug: (message: string, metadata?: LogMetadata) => log("debug", message, metadata),
    info: (message: string, metadata?: LogMetadata) => log("info", message, metadata),
    warn: (message: string, metadata?: LogMetadata) => log("warn", message, metadata),
    error: (message: string, metadata?: LogMetadata) => log("error", message, metadata),
    child: (childBindings: LogMetadata) =>
      createLogger({
        level: minLevel,
        environment,
        bindings: {
          ...bindings,
          ...childBindings,
        },
      }),
  };
};

import * as fs from "fs";
import { inspect } from "util";
import { getCorrelationId } from "./correlation-id.js";
import { StandardError } from "../errors/index.js";
import type { ConsoleLogLevel } from "../../contracts/app-types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogPurpose =
  | "dashboard"
  | "general"
  | "integration"
  | "invocation"
  | "lifecycle"
  | "mcp"
  | "orchestration"
  | "request"
  | "runtime"
  | "settings"
  | "storage"
  | "realtime"
  | "security";

export interface LogMetadata {
  logPurpose?: LogPurpose;
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
  consoleLogLevel?: ConsoleLogLevel;
  getConsoleLogLevel?: () => ConsoleLogLevel | undefined;
  environment?: "development" | "production";
  bindings?: LogMetadata;
  logFilePath?: string;
  color?: boolean;
}

interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  purpose: LogPurpose;
  message: string;
  correlationId?: string;
  metadata?: LogMetadata;
}

const logFileStreams = new Map<string, fs.WriteStream>();

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const PURPOSE_LABELS: Record<LogPurpose, string> = {
  dashboard: "DASH",
  general: "GEN",
  integration: "INT",
  invocation: "INVK",
  lifecycle: "LIFE",
  mcp: "MCP",
  orchestration: "ORCH",
  request: "HTTP",
  runtime: "RUN",
  settings: "CONF",
  storage: "DATA",
  realtime: "LIVE",
  security: "SEC",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};

const PURPOSE_COLORS: Record<LogPurpose, string> = {
  dashboard: "\u001b[35m",
  general: "\u001b[37m",
  integration: "\u001b[34m",
  invocation: "\u001b[32m",
  lifecycle: "\u001b[36m",
  mcp: "\u001b[95m",
  orchestration: "\u001b[96m",
  request: "\u001b[90m",
  runtime: "\u001b[36m",
  settings: "\u001b[33m",
  storage: "\u001b[94m",
  realtime: "\u001b[92m",
  security: "\u001b[31m",
};

const RESET_COLOR = "\u001b[0m";

const normalizeLevel = (level: string | undefined): LogLevel => {
  const normalized = level?.toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
};

const normalizeConsoleLogLevel = (level: string | undefined): ConsoleLogLevel => {
  return level?.toLowerCase() === "full" ? "full" : "standard";
};

const normalizePurpose = (purpose: unknown): LogPurpose | undefined => {
  if (typeof purpose !== "string") {
    return undefined;
  }
  const normalized = purpose.toLowerCase();
  if (normalized in PURPOSE_LABELS) {
    return normalized as LogPurpose;
  }
  return undefined;
};

const inferPurpose = (metadata: LogMetadata | undefined, message: string): LogPurpose => {
  const explicit = normalizePurpose(metadata?.logPurpose);
  if (explicit) {
    return explicit;
  }

  const component = typeof metadata?.component === "string" ? metadata.component : "";
  const lower = `${component} ${message}`.toLowerCase();
  const hasHttpMetadata = typeof metadata?.method === "string"
    && ("statusCode" in (metadata || {}) || "path" in (metadata || {}));
  if (hasHttpMetadata || lower.includes("http request")) return "request";
  if (lower.includes("invocation") || lower.includes("provider")) return "invocation";
  if (lower.includes("mcp")) return "mcp";
  if (lower.includes("realtime") || lower.includes("websocket")) return "realtime";
  if (lower.includes("settings") || lower.includes("config")) return "settings";
  if (lower.includes("sprint") || lower.includes("orchestrat")) return "orchestration";
  if (lower.includes("startup") || lower.includes("running") || lower.includes("recover")) return "lifecycle";
  if (lower.includes("dashboard")) return "dashboard";
  return "general";
};

const normalizeMetadataValue = (value: unknown): unknown => {
  const sanitizeString = (str: string | undefined): string | undefined => {
    if (!str) return str;
    // Replace typical API key patterns or secrets
    return str.replace(/(sk-[a-zA-Z0-9]{20,})/g, "***REDACTED***")
              .replace(/(Bearer [a-zA-Z0-9_\-\.]+)/g, "***REDACTED***")
              .replace(/(api[_-]?key=)[^&\s]+/ig, "$1***REDACTED***")
              .replace(/(password=)[^&\s]+/ig, "$1***REDACTED***");
  };

  if (value instanceof StandardError) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      code: value.code,
      retryable: value.retryable,
      metadata: normalizeMetadataValue(value.metadata),
      cause: normalizeMetadataValue(value.cause),
      stack: sanitizeString(value.stack),
    };
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: sanitizeString(value.stack),
      cause: 'cause' in value ? normalizeMetadataValue(value.cause) : undefined,
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
  const { logPurpose, ...rest } = metadata;
  if (Object.keys(rest).length === 0) {
    return undefined;
  }
  return normalizeMetadataValue(rest) as LogMetadata;
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
  const purposeLabel = PURPOSE_LABELS[record.purpose];
  const correlationSegment = record.correlationId ? ` [correlationId=${record.correlationId}]` : "";
  return `${record.timestamp} ${levelLabel.padEnd(5)} ${purposeLabel}${correlationSegment} ${record.message}${formatMetadataForDevelopment(record.metadata)}`;
};

const colorize = (text: string, color: string, enabled: boolean): string => (
  enabled ? `${color}${text}${RESET_COLOR}` : text
);

const serializeForColoredDevelopment = (record: StructuredLogRecord): string => {
  const levelLabel = colorize(record.level.toUpperCase().padEnd(5), LEVEL_COLORS[record.level], true);
  const purposeLabel = colorize(PURPOSE_LABELS[record.purpose], PURPOSE_COLORS[record.purpose], true);
  const timestamp = colorize(record.timestamp, "\u001b[90m", true);
  const correlationSegment = record.correlationId
    ? colorize(` [correlationId=${record.correlationId}]`, "\u001b[90m", true)
    : "";
  return `${timestamp} ${levelLabel} ${purposeLabel}${correlationSegment} ${record.message}${formatMetadataForDevelopment(record.metadata)}`;
};

export const createLogger = (options: StructuredLoggerOptions = {}): Logger => {
  const minLevel = options.level ?? normalizeLevel(process.env.LOG_LEVEL);
  const staticConsoleLogLevel = options.consoleLogLevel ?? normalizeConsoleLogLevel(process.env.CONSOLE_LOG_LEVEL);
  const getConsoleLogLevel = options.getConsoleLogLevel;
  const environment = options.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const bindings = { ...(options.bindings || {}) };
  const logFilePath = options.logFilePath;
  const useColor = options.color ?? (Boolean(process.stderr.isTTY) && !process.env.NO_COLOR);
  const logFileStream = logFilePath
    ? (() => {
        const existing = logFileStreams.get(logFilePath);
        if (existing) {
          return existing;
        }
        const stream = fs.createWriteStream(logFilePath, { flags: "a" });
        stream.on("error", () => {
          logFileStreams.delete(logFilePath);
        });
        logFileStreams.set(logFilePath, stream);
        return stream;
      })()
    : null;

  const shouldLogBySeverity = (level: LogLevel): boolean => LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
  const resolveConsoleLogLevel = (): ConsoleLogLevel => normalizeConsoleLogLevel(getConsoleLogLevel?.() ?? staticConsoleLogLevel);
  const shouldLogToConsole = (level: LogLevel, purpose: LogPurpose): boolean => {
    if (!shouldLogBySeverity(level)) {
      return false;
    }
    if (resolveConsoleLogLevel() === "full") {
      return true;
    }
    return purpose !== "request";
  };

  const write = (level: LogLevel, purpose: LogPurpose, consoleText: string, fileText: string): void => {
    // In Node.js, console.info/log goes to stdout.
    // MCP uses stdout for its protocol.
    // We must redirect ALL logs to stderr.
    if (shouldLogToConsole(level, purpose)) {
      process.stderr.write(consoleText + "\n");
    }

    if (logFileStream) {
      try {
        logFileStream.write(fileText + "\n");
      } catch {
        // Silently ignore log file write errors to avoid crashing
      }
    }
  };

  const log = (level: LogLevel, message: string, metadata?: LogMetadata): void => {
    if (!shouldLogBySeverity(level)) {
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

    const purpose = inferPurpose({ ...(bindings || {}), ...(metadata || {}) }, message);
    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      purpose,
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
    const consoleSerialized = environment === "production" || !useColor
      ? serialized
      : serializeForColoredDevelopment(record);
    write(level, purpose, consoleSerialized, serialized);
  };

  return {
    debug: (message: string, metadata?: LogMetadata) => log("debug", message, metadata),
    info: (message: string, metadata?: LogMetadata) => log("info", message, metadata),
    warn: (message: string, metadata?: LogMetadata) => log("warn", message, metadata),
    error: (message: string, metadata?: LogMetadata) => log("error", message, metadata),
    child: (childBindings: LogMetadata) =>
      createLogger({
        level: minLevel,
        consoleLogLevel: staticConsoleLogLevel,
        getConsoleLogLevel,
        environment,
        logFilePath,
        color: useColor,
        bindings: {
          ...bindings,
          ...childBindings,
        },
      }),
  };
};

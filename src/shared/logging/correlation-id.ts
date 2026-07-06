import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type { RequestHandler } from "express";

export const CORRELATION_ID_HEADER = "x-correlation-id";

interface CorrelationContext {
  correlationId: string;
}

const correlationContextStorage = new AsyncLocalStorage<CorrelationContext>();

const normalizeCorrelationId = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const extractHeaderCorrelationId = (header: string | string[] | undefined): string | undefined => {
  if (Array.isArray(header)) {
    for (const candidate of header) {
      const normalized = normalizeCorrelationId(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  }
  return normalizeCorrelationId(header);
};

export const generateCorrelationId = (): string => randomUUID();

export const resolveCorrelationId = (value: unknown): string => normalizeCorrelationId(value) ?? generateCorrelationId();

export const getCorrelationId = (): string | undefined => correlationContextStorage.getStore()?.correlationId;

export const runWithCorrelationId = <T>(correlationId: string, operation: () => T): T => {
  return correlationContextStorage.run({ correlationId }, operation);
};

export const runWithResolvedCorrelationId = <T>(operation: () => T, preferredCorrelationId?: unknown): T => {
  return runWithCorrelationId(resolveCorrelationId(preferredCorrelationId), operation);
};

export const correlationIdMiddleware = (): RequestHandler => {
  return (req, res, next) => {
    const requestedCorrelationId =
      extractHeaderCorrelationId(req.header(CORRELATION_ID_HEADER)) ??
      extractHeaderCorrelationId(req.header("x-request-id"));
    const correlationId = resolveCorrelationId(requestedCorrelationId);
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    runWithCorrelationId(correlationId, next);
  };
};

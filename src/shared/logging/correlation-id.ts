import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

interface CorrelationContext {
  correlationId: string;
}

const CORRELATION_ID_HEADER = "x-correlation-id";
const CORRELATION_ID_MAX_LENGTH = 128;
const CORRELATION_ID_ALLOWED = /^[a-zA-Z0-9._:-]+$/;
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

const extractHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
};

const normalizeCorrelationId = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CORRELATION_ID_MAX_LENGTH) {
    return undefined;
  }
  if (!CORRELATION_ID_ALLOWED.test(trimmed)) {
    return undefined;
  }
  return trimmed;
};

export const generateCorrelationId = (): string => randomUUID();

export const getCorrelationId = (): string | undefined => correlationStorage.getStore()?.correlationId;

export const runWithCorrelationId = <T>(correlationId: string, operation: () => T): T =>
  correlationStorage.run({ correlationId }, operation);

export const runWithGeneratedCorrelationId = <T>(operation: () => T): T =>
  runWithCorrelationId(generateCorrelationId(), operation);

export const correlationIdMiddleware: RequestHandler = (req, res, next) => {
  const incomingHeader = extractHeaderValue(req.headers[CORRELATION_ID_HEADER]);
  const correlationId = normalizeCorrelationId(incomingHeader) ?? generateCorrelationId();

  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  runWithCorrelationId(correlationId, next);
};


import { toHttpRouteError } from "./http-errors.js";
import type { Request, Response, RequestHandler } from "express";

export function toErrorResponse(
  error: unknown,
  prefix?: string,
): { error: string; details?: unknown[]; issues?: unknown[] } {
  const message = error instanceof Error ? error.message : String(error);
  const details = error && typeof error === "object" && "details" in error
    ? (error as { details?: unknown }).details
    : undefined;
  const issues = error && typeof error === "object" && "issues" in error
    ? (error as { issues?: unknown }).issues
    : undefined;
  const response = prefix
    ? { error: `${prefix}: ${message}` }
    : { error: message };
  if (Array.isArray(details)) {
    return { ...response, details };
  }
  if (Array.isArray(issues)) {
    return { ...response, issues };
  }
  if (prefix) {
    return response;
  }
  return response;
}

export function syncRoute(handler: (req: Request, res: Response) => void): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        const httpError = toHttpRouteError(error);
        if (httpError.status === 500) {
          res.status(httpError.status).json({ error: "Internal Server Error" });
          next(error);
        } else {
          res.status(httpError.status).json(toErrorResponse(error));
        }
      } else {
        next(error);
      }
    }
  };
}

export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        const httpError = toHttpRouteError(error);
        if (httpError.status === 500) {
          res.status(httpError.status).json({ error: "Internal Server Error" });
          next(error);
        } else {
          res.status(httpError.status).json(toErrorResponse(error));
        }
      } else {
        next(error);
      }
    }
  };
}

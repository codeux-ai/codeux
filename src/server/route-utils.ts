import type { Request, Response, RequestHandler } from "express";

export function parseTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireTrimmedString(value: unknown, name: string): string {
  const trimmed = parseTrimmedString(value);
  if (trimmed === undefined) {
    throw new Error(`Missing or empty required field: ${name}`);
  }
  return trimmed;
}

export function toErrorResponse(error: unknown, prefix?: string): { error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (prefix) {
    return { error: `${prefix}: ${message}` };
  }
  return { error: message };
}

export function syncRoute(handler: (req: Request, res: Response) => void): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(400).json(toErrorResponse(error));
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
        res.status(400).json(toErrorResponse(error));
      } else {
        next(error);
      }
    }
  };
}

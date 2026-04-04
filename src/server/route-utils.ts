import type { Request, Response, RequestHandler } from "express";
import type {
  ImprovePromptInput,
  PlanSprintOptions,
} from "../contracts/project-management-types.js";

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

export function parseThreadRouteInput(body: any): { routeKind: "worker" | "virtual"; virtualProvider?: string; virtualModel?: string; workerEndpointId?: string } {
  const input = {
    routeKind: body?.routeKind as "worker" | "virtual",
    virtualProvider: typeof body?.virtualProvider === "string" ? body.virtualProvider.trim() : undefined,
    virtualModel: typeof body?.virtualModel === "string" ? body.virtualModel.trim() : undefined,
    workerEndpointId: typeof body?.workerEndpointId === "string" ? body.workerEndpointId.trim() : undefined,
  };
  if (input.routeKind !== "worker" && input.routeKind !== "virtual") {
    throw new Error("Invalid routeKind. Must be 'worker' or 'virtual'.");
  }
  return input;
}

export function parseImprovePromptInput(body: any): ImprovePromptInput {
  return {
    name: typeof body?.name === "string" ? body.name.trim() : "",
    goal: typeof body?.goal === "string" ? body.goal : "",
    planningAgentPresetId: typeof body?.planningAgentPresetId === "string" ? body.planningAgentPresetId.trim() : undefined,
    overrides: body?.overrides,
  };
}

export function parsePlanSprintOptions(body: any): PlanSprintOptions {
  return {
    autoStart: Boolean(body?.autoStart),
    replan: Boolean(body?.replan),
    planningAgentPresetId: typeof body?.planningAgentPresetId === "string" ? body.planningAgentPresetId.trim() : undefined,
    overrides: body?.overrides,
  };
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

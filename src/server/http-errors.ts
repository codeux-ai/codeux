import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";

export class HttpRouteError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpRouteError";
  }
}

export function isHttpRouteError(error: unknown): error is HttpRouteError {
  return error instanceof HttpRouteError;
}

export function toHttpRouteError(error: unknown): HttpRouteError {
  if (isHttpRouteError(error)) {
    return error;
  }

  if ((error && typeof error === "object" && "name" in error && error.name === "ValidationError") || error instanceof ValidationError) {
    const msg = "message" in (error as any) ? (error as any).message : "Validation Error";
    return new HttpRouteError(400, msg);
  }

  if ((error && typeof error === "object" && "name" in error && error.name === "EntityNotFoundError") || error instanceof EntityNotFoundError) {
    const msg = "message" in (error as any) ? (error as any).message : "Entity Not Found";
    return new HttpRouteError(404, msg);
  }

  if (error instanceof Error) {
    if (error.message.startsWith("Invalid ") || error.message.startsWith("Missing ")) {
      return new HttpRouteError(400, error.message);
    }
  }

  // Unexpected errors map to 500. We obscure the original error message in the HttpRouteError
  // to avoid leaking internal details or stack traces to the client.
  return new HttpRouteError(500, "Internal Server Error");
}

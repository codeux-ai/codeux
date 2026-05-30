export type ErrorCode =
  | "INTERNAL_ERROR"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RESOURCE_EXHAUSTED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "CONFLICT";

export interface StandardErrorOptions {
  message: string;
  code?: ErrorCode;
  cause?: unknown;
  metadata?: Record<string, unknown>;
  retryable?: boolean;
}

export abstract class StandardError extends Error {
  public readonly code: ErrorCode;
  public readonly metadata: Record<string, unknown>;
  public readonly retryable: boolean;

  constructor(options: StandardErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code ?? "INTERNAL_ERROR";
    this.metadata = options.metadata ?? {};
    this.retryable = options.retryable ?? false;
  }
}

export class TerminalError extends StandardError {
  constructor(options: Omit<StandardErrorOptions, "retryable">) {
    super({ ...options, retryable: false });
  }
}

export class TransientError extends StandardError {
  constructor(options: Omit<StandardErrorOptions, "retryable">) {
    super({ ...options, retryable: true });
  }
}

export class ResourceExhaustedError extends StandardError {
  constructor(options: Omit<StandardErrorOptions, "code" | "retryable"> & { retryable?: boolean }) {
    super({ ...options, code: "RESOURCE_EXHAUSTED", retryable: options.retryable ?? true });
  }
}

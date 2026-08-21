export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_VERIFIED"
  | "FORBIDDEN"
  | "BILLING_REQUIRED"
  | "NOT_FOUND"
  | "GONE"
  | "CONFLICT"
  | "ACTIVE_RUN_EXISTS"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export interface ValidationDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: ValidationDetail[],
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  BILLING_REQUIRED: 402,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ACTIVE_RUN_EXISTS: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function httpStatus(code: ErrorCode): number {
  return statusByCode[code];
}

export function notFound(what: string): AppError {
  return new AppError("NOT_FOUND", `${what} not found`);
}

export function forbidden(
  message = "You do not have permission to perform this action",
): AppError {
  return new AppError("FORBIDDEN", message);
}

export function conflict(message: string): AppError {
  return new AppError("CONFLICT", message);
}

export function unavailable(message: string): AppError {
  return new AppError("SERVICE_UNAVAILABLE", message);
}

export function validation(details: ValidationDetail[]): AppError {
  return new AppError("VALIDATION_ERROR", "Invalid request", details);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

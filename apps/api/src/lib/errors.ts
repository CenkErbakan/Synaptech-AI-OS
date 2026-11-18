export type ApiErrorCode =
  | "Unauthorized"
  | "Forbidden"
  | "ValidationError"
  | "Conflict"
  | "NotFound"
  | "KillSwitchActive"
  | "IntegrationUnavailable"
  | "RateLimited"
  | "InternalError";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function unauthorized(message = "Kimlik doğrulaması gerekli."): ApiError {
  return new ApiError("Unauthorized", message, 401);
}

export function forbidden(message = "Bu işlem için yetkiniz yok."): ApiError {
  return new ApiError("Forbidden", message, 403);
}

export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError("ValidationError", message, 400, details);
}

export function notFound(message = "Kayıt bulunamadı."): ApiError {
  return new ApiError("NotFound", message, 404);
}

export function conflict(message: string): ApiError {
  return new ApiError("Conflict", message, 409);
}

export function killSwitchActive(message = "Kill switch açık: işlem engellendi."): ApiError {
  return new ApiError("KillSwitchActive", message, 423);
}

export function integrationUnavailable(message: string): ApiError {
  return new ApiError("IntegrationUnavailable", message, 503);
}

export function toErrorBody(error: ApiError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

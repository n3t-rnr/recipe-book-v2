import { ERROR_STATUS, type ErrorCode, type ErrorStatus } from '../shared/error-codes.ts';

export { ERROR_STATUS, type ErrorBody, type ErrorCode, type ErrorStatus } from '../shared/error-codes.ts';

/** The only error type services throw; the error middleware turns it into the JSON error format (Kap. 7.1). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

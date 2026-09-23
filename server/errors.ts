/** Error codes and HTTP status (Kap. 7.2). The client maps every code to a German text (NF-10). */
export const ERROR_STATUS = {
  VALIDATION: 400,
  BAD_REQUEST: 400,
  PROFILE_REQUIRED: 401,
  PROFILE_UNKNOWN: 401,
  NOT_FOUND: 404,
  IN_TRASH: 410,
  VERSION_CONFLICT: 409,
  NAME_EXISTS: 409,
  TAG_EXISTS: 409,
  LAST_PROFILE: 409,
  NOT_IN_TRASH: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  MISDIRECTED: 421,
  INTERNAL: 500,
  IMAGES_UNAVAILABLE: 503,
  READ_ONLY: 503,
  INSUFFICIENT_STORAGE: 507,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export type ErrorStatus = (typeof ERROR_STATUS)[ErrorCode];

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

/** Wire format of an error response. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/** Error codes and HTTP status (Kap. 7.2). Shared so the client can map every code to a German text (NF-10). */
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
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export interface ValidationDetail {
  /** Dotted path, e.g. "title" or "ingredients.2.name". */
  field: string;
  message: string;
}

/** Wire format of every API error (Kap. 7.1). */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

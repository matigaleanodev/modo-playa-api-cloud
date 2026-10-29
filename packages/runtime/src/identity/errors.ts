export class DomainException extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export class AuthException extends DomainException {
  constructor(message: string, code: string) {
    super(message, code, 401);
  }
}
export class HttpException extends Error {
  constructor(
    readonly status: number,
    readonly body: object,
  ) {
    super('HTTP error');
  }
}
export const ERROR_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_DISABLED: 'USER_DISABLED',
  PASSWORD_ALREADY_SET: 'PASSWORD_ALREADY_SET',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_USER_ID: 'INVALID_USER_ID',
  INVALID_OWNER_ID: 'INVALID_OWNER_ID',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
} as const;

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'ورود لازم است') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'دسترسی مجاز نیست') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'مورد یافت نشد') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
export const tooMany = (msg = 'تعداد درخواست بیش از حد مجاز است') => new AppError(429, 'RATE_LIMITED', msg);

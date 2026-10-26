export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Autentifică-te pentru a continua.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Doar administratorii pot face această operație.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resursa nu a fost găsită.') =>
  new AppError(404, 'NOT_FOUND', message);

export const validation = (message: string) => new AppError(400, 'VALIDATION_ERROR', message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const accountBlocked = (message = 'Contul tău a fost blocat de administrator.') =>
  new AppError(403, 'ACCOUNT_BLOCKED', message);

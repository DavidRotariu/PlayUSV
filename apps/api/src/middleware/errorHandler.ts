import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: 'Resursa nu a fost găsită.' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const message =
      issue.code === 'custom'
        ? issue.message
        : `Câmpul „${issue.path.join('.') || 'body'}” lipsește sau nu este valid.`;
    res.status(400).json({ code: 'VALIDATION_ERROR', message });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Corpul cererii nu este JSON valid.' });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'A apărut o eroare neașteptată.' });
};

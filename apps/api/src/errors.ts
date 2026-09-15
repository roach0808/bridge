import { Prisma } from '@prisma/client';
import { ERROR_CODES, type ErrorCode } from '@god/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, ERROR_CODES.validation, message, details);
export const unauthenticated = (message = 'Sign in to continue', code: string = ERROR_CODES.unauthenticated) =>
  new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that') =>
  new HttpError(403, ERROR_CODES.forbidden, message);
export const notFound = (what = 'Resource') => new HttpError(404, ERROR_CODES.notFound, `${what} not found`);
export const conflict = (message: string, code: string = ERROR_CODES.conflict, details?: unknown) =>
  new HttpError(409, code, message, details);

export const expertBusy = () =>
  conflict('The Expert already has a call at that time', ERROR_CODES.expertBusy);

function isConstraintError(err: unknown, name: string): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? '')}`;
  return text.includes(name);
}

/** Maps database errors to typed HTTP errors. Returns undefined if unknown. */
export function mapDatabaseError(err: unknown): HttpError | undefined {
  if (isConstraintError(err, 'calls_expert_no_overlap')) return expertBusy();
  if (isConstraintError(err, 'calls_expert_required_when_scheduled'))
    return conflict('An Expert must be assigned once the call is scheduled', ERROR_CODES.expertRequired);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta?.target as string[] | string | undefined) ?? 'value';
        const field = Array.isArray(target) ? target.join(', ') : target;
        return conflict(`That ${field} is already taken`, ERROR_CODES.conflict, { field });
      }
      case 'P2003':
        return conflict('This record is still referenced elsewhere', ERROR_CODES.conflict);
      case 'P2025':
        return notFound();
    }
  }
  if (err instanceof Error && /violates check constraint/i.test(err.message)) {
    const match = /check constraint "([^"]+)"/.exec(err.message);
    return badRequest('The data breaks a database rule', { constraint: match?.[1] });
  }
  return undefined;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let httpError: HttpError;
  if (err instanceof HttpError) {
    httpError = err;
  } else if (err instanceof ZodError) {
    httpError = badRequest(err.issues[0]?.message ?? 'Invalid request', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  } else if (err?.type === 'entity.too.large') {
    httpError = new HttpError(413, ERROR_CODES.validation, 'Request body is too large');
  } else if (err?.type === 'entity.parse.failed') {
    httpError = badRequest('Malformed JSON body');
  } else {
    httpError =
      mapDatabaseError(err) ?? new HttpError(500, ERROR_CODES.internal, 'Something went wrong on our side');
  }

  if (httpError.status >= 500) {
    (req.log ?? logger).error({ err }, 'unhandled error');
  }

  res.status(httpError.status).json({
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details !== undefined ? { details: httpError.details } : {}),
    },
  });
};

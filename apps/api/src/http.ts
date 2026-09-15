import type { Request, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

const snakeToCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Deep-converts snake_case keys to camelCase so both spellings are accepted. */
export function camelizeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(camelizeKeys) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [snakeToCamel(k), camelizeKeys(v)]),
    ) as T;
  }
  return value;
}

export const camelizeBody: RequestHandler = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = camelizeKeys(req.body);
  next();
};

function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(issues[0]?.message ?? 'Invalid request', { issues });
  }
  return result.data;
}

export const parseBody = <S extends ZodTypeAny>(schema: S, req: Request): z.output<S> =>
  parse(schema, req.body ?? {});

export const parseQuery = <S extends ZodTypeAny>(schema: S, req: Request): z.output<S> =>
  parse(schema, camelizeKeys({ ...(req.query as Record<string, unknown>) }));

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw badRequest(`Missing ${name}`);
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route id param that must be a UUID; malformed ids are simply not found. */
export function idParam(req: Request, name = 'id'): string | null {
  const value = param(req, name);
  return UUID_RE.test(value) ? value : null;
}

export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const fromDateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

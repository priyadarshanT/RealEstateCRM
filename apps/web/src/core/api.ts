import type { paths, Schemas } from '@crm/contracts';
import createClient from 'openapi-fetch';

// Typed client for the CRM API. Calls go to this web server's /api/v1 proxy, which adds the login token.

export const api = createClient<paths>({ baseUrl: '/api/v1' });

export type Problem = Schemas['Problem'];

/** An API error in problem-details form, thrown so TanStack Query sees it as a failure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Partial<Problem>,
  ) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`);
  }

  fieldError(field: string): string | undefined {
    return this.problem.errors?.find((e) => e.field === field)?.message;
  }
}

/** Unwraps an openapi-fetch result: returns the data or throws ApiError. Sends the user to login on 401. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  const { response } = result;
  if (response.ok) return result.data as T;
  if (response.status === 401 && typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.startsWith('/console')) {
      if (path !== '/console/login') window.location.href = '/console/login';
    } else if (!path.startsWith('/login') && !path.startsWith('/signup')) {
      window.location.href = `/login?next=${encodeURIComponent(path + window.location.search)}`;
    }
  }
  const problem = (result.error ?? {}) as Partial<Problem>;
  throw new ApiError(response.status, problem);
}

/** User-facing message for any error thrown by a query or mutation. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/** Random key for the Idempotency-Key header, so a double click never creates duplicates. */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}

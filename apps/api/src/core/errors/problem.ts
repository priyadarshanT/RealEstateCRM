// Problem details (RFC 9457), as defined by `Problem` in api/openapi.yaml.
export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemBody {
  type?: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: FieldError[];
  requestId?: string;
  /** Extra members for specific errors, e.g. the existing lead with 409 LEAD_EXISTS (RFC 9457 extensions). */
  [extension: string]: unknown;
}

const ERROR_TYPE_BASE = 'https://crm.example.ae/errors/';

/** Throw from any layer to return a specific business error, e.g. new ProblemException(409, 'LEAD_EXISTS', ...). */
export class ProblemException extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly extensions?: Record<string, unknown>,
  ) {
    super(detail ?? title);
  }

  toBody(requestId?: string): ProblemBody {
    return {
      type: ERROR_TYPE_BASE + this.code.toLowerCase().replace(/_/g, '-'),
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.errors?.length ? { errors: this.errors } : {}),
      ...(this.extensions ?? {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

export const Problems = {
  unauthorized: (detail = 'Sign in again.') => new ProblemException(401, 'UNAUTHORIZED', 'Not signed in', detail),
  forbidden: (detail = 'You are not allowed to do this.') => new ProblemException(403, 'FORBIDDEN', 'Not allowed', detail),
  notFound: (detail = 'The record was not found.') => new ProblemException(404, 'NOT_FOUND', 'Not found', detail),
  validation: (errors: FieldError[]) => new ProblemException(400, 'VALIDATION_FAILED', 'Invalid input', undefined, errors),
  tenantSuspended: () =>
    new ProblemException(403, 'TENANT_SUSPENDED', 'Company suspended', 'This company has been suspended. Contact support.'),
  readOnly: () =>
    new ProblemException(
      402,
      'SUBSCRIPTION_READ_ONLY',
      'Subscription unpaid',
      'Payment is overdue. You can view and export data but cannot make changes until the subscription is paid.',
    ),
};

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemException } from './problem';

// PostgreSQL error codes raised by the database rules (constraints, triggers, row-level security).
const PG_CHECK_VIOLATION = '23514';
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_INSUFFICIENT_PRIVILEGE = '42501';

/** Turns every error into application/problem+json. Internal details are logged, never returned. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    const response = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(error);
    if (problem.status >= 500) this.logger.error(error instanceof Error ? error.stack : String(error), request.requestId);
    response.status(problem.status).type('application/problem+json').json(problem.toBody(request.requestId));
  }

  private toProblem(error: unknown): ProblemException {
    if (error instanceof ProblemException) return error;
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 429 ? 'TOO_MANY_REQUESTS' : `HTTP_${status}`;
      return new ProblemException(status, code, error.message);
    }
    const pgCode = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    switch (pgCode) {
      case PG_CHECK_VIOLATION:
        return new ProblemException(422, 'BUSINESS_RULE', 'Business rule failed', this.pgMessage(error));
      case PG_UNIQUE_VIOLATION:
        return new ProblemException(409, 'CONFLICT', 'Already exists');
      case PG_FOREIGN_KEY_VIOLATION:
        return new ProblemException(422, 'INVALID_REFERENCE', 'A linked record does not exist');
      case PG_INSUFFICIENT_PRIVILEGE:
        return new ProblemException(403, 'FORBIDDEN', 'Not allowed');
      default:
        return new ProblemException(500, 'INTERNAL', 'Something went wrong');
    }
  }

  // Messages raised by our own triggers are written for users (e.g. "Seat limit reached ...").
  private pgMessage(error: unknown): string | undefined {
    const e = error as { message?: string; cause?: { message?: string }; constraint?: string };
    const message = e.cause?.message ?? e.message;
    return e.constraint ? undefined : message;
  }
}

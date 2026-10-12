import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable } from 'rxjs';
import { AuthenticatedRequest, Principal } from '../auth/principal';

/** Who is calling and from where; available anywhere during a request (used by the audit log). */
export interface RequestInfo {
  userId?: string;
  tenantId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  /** The signed-in user (absent for jobs and webhooks). */
  principal?: Principal;
}

const storage = new AsyncLocalStorage<RequestInfo>();

export const RequestContext = {
  get: (): RequestInfo => storage.getStore() ?? {},
  run: <T>(info: RequestInfo, work: () => T): T => storage.run(info, work),
};

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const info: RequestInfo = {
      userId: req.principal?.userId,
      tenantId: req.principal?.tenantId,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.header('user-agent')?.slice(0, 500),
      principal: req.principal,
    };
    return new Observable((subscriber) => RequestContext.run(info, () => next.handle().subscribe(subscriber)));
  }
}

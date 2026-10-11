import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import { AuthenticatedRequest } from '../auth/principal';
import { DbService } from './db.service';

/** Runs each signed-in request in one transaction for the caller's tenant (step 2 of the request checks). */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) return next.handle();
    return from(this.db.withTenant(principal.tenantId, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }
}

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModuleOptions } from '@nestjs/throttler';
import { AuthenticatedRequest } from '../auth/principal';
import { ProblemException } from '../errors/problem';

// API guide §10: a signed-in user may send 600 requests per minute. Requests without a user count per IP.
export const rateLimits: ThrottlerModuleOptions = [{ name: 'user', ttl: 60_000, limit: 600 }];

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async getTracker(req: AuthenticatedRequest): Promise<string> {
    return req.principal ? `user:${req.principal.userId}` : `ip:${req.ip}`;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new ProblemException(429, 'TOO_MANY_REQUESTS', 'Too many requests', 'Please wait a moment and try again.');
  }
}

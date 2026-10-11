import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/** Gives each request an ID (kept from X-Request-Id when sent) and echoes it back, for logs and error bodies. */
export function requestId(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

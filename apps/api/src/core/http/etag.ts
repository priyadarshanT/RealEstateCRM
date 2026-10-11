// Optimistic locking (API guide §5): GET returns an ETag; PATCH with a stale If-Match returns 409 VERSION_CONFLICT.
import { ProblemException } from '../errors/problem';

/** ETag for a row version (its updated_at text, or a version counter). */
export function toEtag(version: string | number): string {
  return `"${Buffer.from(String(version)).toString('base64url')}"`;
}

/** The row version from an If-Match header, or undefined when the header is absent or "*". */
export function parseIfMatch(header: string | undefined): string | undefined {
  if (!header || header.trim() === '*') return undefined;
  const tag = header.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return Buffer.from(tag, 'base64url').toString('utf8');
}

export const versionConflict = (): ProblemException =>
  new ProblemException(409, 'VERSION_CONFLICT', 'Changed by someone else', 'Someone else saved this record first. Reload and try again.');

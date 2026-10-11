import { Matches, ValidationOptions } from 'class-validator';

// Any UUID PostgreSQL accepts (8-4-4-4-12 hex). Stricter RFC version checks would reject valid stored IDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function IsUuid(options?: ValidationOptions): PropertyDecorator {
  return Matches(UUID, { message: '$property must be a UUID', ...options });
}

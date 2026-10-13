import { Matches, ValidateBy, ValidationOptions } from 'class-validator';
import { isDateOnly } from './dates';

// Any UUID PostgreSQL accepts (8-4-4-4-12 hex). Stricter RFC version checks would reject valid stored IDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function IsUuid(options?: ValidationOptions): PropertyDecorator {
  return Matches(UUID, { message: '$property must be a UUID', ...options });
}

export const IS_DATE_ONLY = 'isDateOnly';

/**
 * For every `format: date` field (YYYY-MM-DD). Use instead of IsDateString, which also accepts full timestamps;
 * a timestamp must be rejected with 400, not turned into an invalid date. test/contract.spec.ts enforces this.
 */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_DATE_ONLY,
      validator: {
        validate: (value) => isDateOnly(value),
        defaultMessage: () => '$property must be a date (YYYY-MM-DD)',
      },
    },
    options,
  );
}

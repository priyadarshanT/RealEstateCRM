import { ValidationError, ValidationPipe } from '@nestjs/common';
import { Problems } from './problem';

function flatten(errors: ValidationError[], parent = ''): { field: string; message: string }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Step 5 of the request checks: input is validated against the DTO; failures return 400 with errors[]. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => Problems.validation(flatten(errors)),
  });
}

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export function Checkbox({ className, checked, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border border-border bg-surface text-primary-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>{checked === 'indeterminate' ? <Minus className="size-3" /> : <Check className="size-3" />}</CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

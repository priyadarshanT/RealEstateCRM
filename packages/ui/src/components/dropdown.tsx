import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export const Dropdown = Menu.Root;
export const DropdownTrigger = Menu.Trigger;

const item = 'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50';

export function DropdownContent({ className, align = 'start', ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={4}
        className={cn('z-50 max-h-80 min-w-44 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg', className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownItem({ className, ...props }: React.ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(item, className)} {...props} />;
}

/** Checkbox item that keeps the menu open, for multi-select lists such as column choosers. */
export function DropdownCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(item, className)} onSelect={(e) => e.preventDefault()} {...props}>
      <span className="flex size-4 items-center justify-center rounded border border-border text-primary">
        <Menu.ItemIndicator>
          <Check className="size-3" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

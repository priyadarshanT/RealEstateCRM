'use client';

import { Input, Popover, PopoverAnchor, PopoverContent, Spinner } from '@crm/ui';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/core/api';

/** SRS §1.3: search by name, phone or email from any screen (GET /search). */
export function GlobalSearch() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const result = useQuery({
    queryKey: ['search', q],
    enabled: q.length >= 2,
    queryFn: async () => unwrap(await api.GET('/search', { params: { query: { q, limit: 8 } } })),
  });

  const leads = result.data?.leads ?? [];
  const users = result.data?.users ?? [];

  function go(path: string) {
    setOpen(false);
    setText('');
    router.push(path);
  }

  return (
    <Popover open={open && q.length >= 2} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative max-w-xl flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search name, phone or email…"
            className="bg-muted pl-8"
            aria-label="Search"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        {result.isFetching ? (
          <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </div>
        ) : leads.length + users.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">No matches.</p>
        ) : (
          <>
            {leads.length ? <p className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">Leads</p> : null}
            {leads.map((l) => (
              <button key={l.id} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => go(`/leads/${l.id}`)}>
                {l.name ?? l.id}
              </button>
            ))}
            {users.length ? <p className="px-2 pt-2 text-xs font-semibold uppercase text-muted-foreground">Users</p> : null}
            {users.map((u) => (
              <button key={u.id} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => go('/team')}>
                {u.name ?? u.id}
              </button>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

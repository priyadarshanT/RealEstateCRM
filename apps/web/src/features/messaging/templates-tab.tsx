'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, Table, Td, Textarea, Th, Tr } from '@crm/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { CHANNEL_LABEL, placeholders, useTemplateMutations, useTemplates, type Template } from './messaging-api';

const STATUS_TONE = { draft: 'neutral', pending: 'warning', approved: 'success', rejected: 'danger', disabled: 'neutral' } as const;

/**
 * Message templates (SRS §5.2, §11.5): brochures, follow-ups, meeting confirmations. WhatsApp templates are sent
 * to Meta for approval and cannot change afterwards; email templates are ready once submitted.
 */
export function TemplatesTab() {
  const templates = useTemplates();
  const { remove, submit } = useTemplateMutations();
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const error = remove.error ?? submit.error;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Use placeholders such as {'{{first_name}}'} and list them as variables. Agents fill them when sending.</p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> New template
        </Button>
      </div>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {templates.isLoading ? <Loading /> : null}
      <Table>
        <thead>
          <tr>
            <Th>Template</Th>
            <Th>Channel</Th>
            <Th>Category</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(templates.data ?? []).map((t) => {
            const locked = t.channel === 'whatsapp' && (t.status === 'pending' || t.status === 'approved');
            return (
              <Tr key={t.id}>
                <Td>
                  <p className="font-medium">
                    {t.name} <span className="text-xs text-muted-foreground">· {t.language}</span>
                  </p>
                  <p className="line-clamp-2 max-w-md text-xs text-muted-foreground">{t.subject ? `${t.subject} — ` : ''}{t.body}</p>
                </Td>
                <Td>{CHANNEL_LABEL[t.channel]}</Td>
                <Td className="capitalize">{t.category}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[t.status]}>{t.status === 'pending' ? 'Waiting for Meta' : t.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {t.status === 'draft' || t.status === 'rejected' ? (
                    <Button variant="link" size="sm" disabled={submit.isPending} onClick={() => submit.mutate(t.id)}>
                      {t.channel === 'whatsapp' ? 'Send for approval' : 'Make ready'}
                    </Button>
                  ) : null}
                  {!locked ? (
                    <Button variant="link" size="sm" className="ml-3" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                  ) : null}
                  <Button variant="link" size="sm" className="ml-3 text-danger" onClick={() => window.confirm(`Delete template ${t.name}?`) && remove.mutate(t.id)}>
                    Delete
                  </Button>
                </Td>
              </Tr>
            );
          })}
          {templates.data?.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-center text-muted-foreground">
                No templates yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <TemplateDialog template={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function TemplateDialog({ template, onClose }: { template: Template | 'new' | null; onClose: () => void }) {
  const { create, update } = useTemplateMutations();
  const existing = template && template !== 'new' ? template : null;
  const [form, setForm] = useState<Partial<Template> | null>(null);
  const v: Partial<Template> = form ?? existing ?? { channel: 'whatsapp', language: 'en', category: 'utility', variables: [] };
  const set = (p: Partial<Template>) => setForm({ ...v, ...p });
  const used = [...new Set([...placeholders(v.subject), ...placeholders(v.body)])];
  const examples = Object.fromEntries((v.variables ?? []).map((x) => [x.name, x.example ?? '']));
  const m = existing ? update : create;
  const err = (f: string) => (m.error instanceof ApiError ? m.error.fieldError(f) : undefined);

  function close() {
    setForm(null);
    create.reset();
    update.reset();
    onClose();
  }

  async function save() {
    const body = {
      ...(existing ? {} : { channel: v.channel }),
      name: v.name,
      language: v.language,
      category: v.category,
      subject: v.channel === 'email' ? (v.subject ?? '') : null,
      body: v.body,
      // Every placeholder used becomes a variable; the example helps agents fill it.
      variables: used.map((name) => ({ name, ...(examples[name] ? { example: examples[name] } : {}) })),
    };
    const ok = existing ? await update.mutateAsync({ id: existing.id, ...body }).catch(() => null) : await create.mutateAsync(body).catch(() => null);
    if (ok) close();
  }

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && close()}>
      <DialogContent title={existing ? `Edit ${existing.name}` : 'New template'} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel">
            <Select value={v.channel} disabled={!!existing} onChange={(e) => set({ channel: e.target.value as Template['channel'] })}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </Select>
          </Field>
          <Field label="Name (lowercase, digits, _)" error={err('name')}>
            <Input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="beachfront_brochure" />
          </Field>
          <Field label="Language" error={err('language')}>
            <Select value={v.language} onChange={(e) => set({ language: e.target.value })}>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
              <option value="ru">Russian</option>
              <option value="hi">Hindi</option>
              <option value="fr">French</option>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={v.category} onChange={(e) => set({ category: e.target.value as Template['category'] })}>
              <option value="utility">Utility (follow-ups, confirmations)</option>
              <option value="marketing">Marketing (offers, launches)</option>
              {v.channel === 'email' ? <option value="transactional">Transactional</option> : <option value="authentication">Authentication</option>}
            </Select>
          </Field>
          {v.channel === 'email' ? (
            <Field label="Subject" error={err('subject')} className="sm:col-span-2">
              <Input value={v.subject ?? ''} onChange={(e) => set({ subject: e.target.value })} />
            </Field>
          ) : null}
          <Field label="Message" error={err('body')} className="sm:col-span-2">
            <Textarea className="min-h-32" value={v.body ?? ''} onChange={(e) => set({ body: e.target.value })} placeholder="Hi {{first_name}}, here is the {{project}} brochure." />
          </Field>
          {used.length ? (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-xs font-medium text-muted-foreground">Variables and example values</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {used.map((n) => (
                  <Field key={n} label={n}>
                    <Input
                      value={examples[n] ?? ''}
                      onChange={(e) => set({ variables: used.map((x) => ({ name: x, example: x === n ? e.target.value : (examples[x] ?? '') })) })}
                      placeholder="Example"
                    />
                  </Field>
                ))}
              </div>
            </div>
          ) : null}
          {m.error ? <Alert className="sm:col-span-2">{errorMessage(m.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={m.isPending || !v.name || !v.body} onClick={save}>
              Save template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

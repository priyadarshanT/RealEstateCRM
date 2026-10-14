'use client';

import { Alert, Badge, Button, Dialog, DialogContent, Field, Input, Loading, Select, Table, Td, Th, Tr } from '@crm/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatDate } from '@/core/format';
import { useCan } from '@/core/session';
import { CONSTRUCTION_LABEL, Project, useDevelopers, useProjectActions, useProjects } from './projects-api';

/** Projects (SRS §6.1): every project with its developer, build status, handover and inventory. Units live inside each project. */
export function ProjectsScreen() {
  const can = useCan();
  const router = useRouter();
  const [developerId, setDeveloperId] = useState('');
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState<'project' | 'developer' | null>(null);
  const developers = useDevelopers();
  const devName = new Map((developers.data ?? []).map((d) => [d.id, d.name]));
  const list = useProjects({ ...(developerId ? { developerId } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(showInactive ? {} : { isActive: true }) });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Projects</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <Select className="h-8 w-auto text-xs" value={developerId} onChange={(e) => setDeveloperId(e.target.value)} aria-label="Developer">
          <option value="">All developers</option>
          {developers.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <span className="ml-auto" />
        {can('projects.manage') ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setCreating('developer')}>
              <Plus /> Developer
            </Button>
            <Button size="sm" onClick={() => setCreating('project')}>
              <Plus /> New project
            </Button>
          </>
        ) : null}
      </div>
      {list.error ? <Alert>{errorMessage(list.error)}</Alert> : null}
      {list.isLoading ? <Loading /> : null}
      <Table>
        <thead>
          <tr>
            <Th>Project</Th>
            <Th>Developer</Th>
            <Th>Status</Th>
            <Th>Handover</Th>
            <Th>Available</Th>
            <Th>On hold</Th>
            <Th>Booked</Th>
            <Th>Sold</Th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((p) => (
            <Tr key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
              <Td>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{[p.community, p.city].filter(Boolean).join(', ')}</p>
              </Td>
              <Td>{devName.get(p.developerId) ?? '—'}</Td>
              <Td>
                <Badge tone={p.isActive ? 'primary' : 'neutral'}>{p.isActive ? CONSTRUCTION_LABEL[p.constructionStatus] : 'Inactive'}</Badge>
              </Td>
              <Td className="text-xs">{p.handoverDate ? formatDate(p.handoverDate, 'UTC') : '—'}</Td>
              <Td className="font-medium text-success">{p.inventory?.available ?? 0}</Td>
              <Td>{p.inventory?.onHold ?? 0}</Td>
              <Td>{p.inventory?.booked ?? 0}</Td>
              <Td>{p.inventory?.sold ?? 0}</Td>
            </Tr>
          ))}
          {list.data?.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-center text-muted-foreground">
                No projects yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <DeveloperDialog open={creating === 'developer'} onClose={() => setCreating(null)} />
      <ProjectDialog open={creating === 'project'} onClose={() => setCreating(null)} onSaved={(p) => router.push(`/projects/${p.id}`)} />
    </div>
  );
}

function DeveloperDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createDeveloper } = useProjectActions();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (createDeveloper.error instanceof ApiError ? createDeveloper.error.fieldError(k) : undefined);
  const close = () => {
    setF({});
    createDeveloper.reset();
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="New developer">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
            if (await createDeveloper.mutateAsync(body).catch(() => null)) close();
          }}
        >
          <Field label="Name *" error={err('name')} className="sm:col-span-2">
            <Input value={f.name ?? ''} onChange={set('name')} placeholder="Emaar Properties" />
          </Field>
          <Field label="Contact person">
            <Input value={f.contactName ?? ''} onChange={set('contactName')} />
          </Field>
          <Field label="VAT number (TRN)">
            <Input value={f.trn ?? ''} onChange={set('trn')} />
          </Field>
          <Field label="Email" error={err('email')}>
            <Input type="email" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Phone" error={err('phone')}>
            <Input value={f.phone ?? ''} onChange={set('phone')} placeholder="+971 4 123 4567" />
          </Field>
          <Field label="Website" className="sm:col-span-2">
            <Input value={f.website ?? ''} onChange={set('website')} />
          </Field>
          {createDeveloper.error && !(createDeveloper.error instanceof ApiError && createDeveloper.error.status === 400) ? <Alert className="sm:col-span-2">{errorMessage(createDeveloper.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={createDeveloper.isPending || !f.name?.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** New project, or edit an existing one. */
export function ProjectDialog({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project?: Project; onSaved?: (p: Project) => void }) {
  const { createProject, updateProject } = useProjectActions();
  const developers = useDevelopers();
  const [f, setF] = useState<Record<string, string>>({});
  const value = (k: keyof Project) => f[k] ?? (project?.[k] === null || project?.[k] === undefined ? '' : String(project[k]));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = project ? updateProject : createProject;
  const err = (k: string) => (save.error instanceof ApiError ? save.error.fieldError(k) : undefined);
  const close = () => {
    setF({});
    save.reset();
    onClose();
  };

  async function submit() {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      if (k === 'isActive') body[k] = v === 'true';
      else body[k] = v.trim() === '' ? (project ? null : undefined) : v.trim();
    }
    const saved = await (project ? updateProject.mutateAsync({ id: project.id, ...body }) : createProject.mutateAsync(body)).catch(() => null);
    if (saved) {
      onSaved?.(saved);
      close();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={project ? 'Edit project' : 'New project'} wide>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name *" error={err('name')}>
            <Input value={value('name')} onChange={set('name')} />
          </Field>
          <Field label="Developer *" error={err('developerId')}>
            <Select value={value('developerId')} onChange={set('developerId')}>
              <option value="">Choose…</option>
              {developers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Community">
            <Input value={value('community')} onChange={set('community')} placeholder="Dubai Creek Harbour" />
          </Field>
          <Field label="City">
            <Input value={value('city') || (project ? '' : 'Dubai')} onChange={set('city')} />
          </Field>
          <Field label="Build status">
            <Select value={value('constructionStatus') || 'off_plan'} onChange={set('constructionStatus')}>
              {Object.entries(CONSTRUCTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Handover date" error={err('handoverDate')}>
            <Input type="date" value={value('handoverDate')} onChange={set('handoverDate')} />
          </Field>
          <Field label="Payment plan">
            <Input value={value('paymentPlan')} onChange={set('paymentPlan')} placeholder="80/20" />
          </Field>
          <Field label="Address">
            <Input value={value('address')} onChange={set('address')} />
          </Field>
          {project ? (
            <Field label="Active">
              <Select value={value('isActive')} onChange={set('isActive')}>
                <option value="true">Active (shown to agents)</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Description" className="sm:col-span-2">
            <textarea className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" value={value('description')} onChange={set('description')} />
          </Field>
          {save.error && !(save.error instanceof ApiError && save.error.status === 400) ? <Alert className="sm:col-span-2">{errorMessage(save.error)}</Alert> : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || (!project && (!f.name?.trim() || !f.developerId))}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

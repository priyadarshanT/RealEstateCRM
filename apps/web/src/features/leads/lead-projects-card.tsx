'use client';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent } from '@crm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage, unwrap } from '@/core/api';
import { byId, useProjectList } from '@/core/lookups';
import type { Lead } from './leads-api';

/** Projects the lead is interested in (SRS §2: a lead can be linked to several projects; one is the main one). */
export function LeadProjectsCard({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const projects = useProjectList();
  const names = byId(projects.data);
  const [editing, setEditing] = useState(false);
  const ids = lead.projectIds ?? [];
  return (
    <Card>
      <CardHeader
        title="Projects of interest"
        actions={
          canEdit ? (
            <Button variant="link" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <Link key={id} href={`/projects/${id}`}>
            <Badge tone={id === lead.primaryProjectId ? 'primary' : 'neutral'}>
              {names.get(id)?.name ?? 'Project'}
              {id === lead.primaryProjectId ? ' · main' : ''}
            </Badge>
          </Link>
        ))}
        {ids.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
      </CardBody>
      {editing ? <EditProjects lead={lead} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

function EditProjects({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useProjectList();
  const [ids, setIds] = useState<string[]>(lead.projectIds ?? []);
  const [primary, setPrimary] = useState<string | undefined>(lead.primaryProjectId ?? undefined);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.PUT('/leads/{id}/projects', { params: { path: { id: lead.id } }, body: { projectIds: ids, ...(primary && ids.includes(primary) ? { primaryProjectId: primary } : {}) } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
      onClose();
    },
  });
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const active = (projects.data ?? []).filter((p) => p.isActive || ids.includes(p.id));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Projects of interest">
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {active.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
              <label className="flex flex-1 items-center gap-2">
                <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}
              </label>
              {ids.includes(p.id) ? (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="radio" name="primary" checked={primary === p.id} onChange={() => setPrimary(p.id)} /> Main
                </label>
              ) : null}
            </div>
          ))}
          {active.length === 0 ? <p className="text-sm text-muted-foreground">No projects yet. They are added under Projects.</p> : null}
        </div>
        {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Alert, Badge, Button, Card, CardBody, Dialog, DialogContent, Field, Input, Loading, Select, StatCard, Table, Td, Th, Tr } from '@crm/ui';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/core/api';
import { formatDate } from '@/core/format';
import { useCan } from '@/core/session';
import { ProjectDialog } from './projects-screen';
import {
  CONSTRUCTION_LABEL,
  formatPrice,
  PROPERTY_TYPE_LABEL,
  Unit,
  UNIT_STATUS_LABEL,
  UNIT_STATUS_TONE,
  UnitFilters,
  useBuildings,
  useDevelopers,
  useProject,
  useProjectActions,
  useUnits,
} from './projects-api';
import { UnitDialog } from './unit-dialog';

/** One project (SRS §6.1–6.2): details, buildings, inventory and its units, filtered inside the project. */
export function ProjectDetailScreen({ id }: { id: string }) {
  const can = useCan();
  const project = useProject(id);
  const buildings = useBuildings(id);
  const developers = useDevelopers();
  const [filters, setFilters] = useState<UnitFilters>({});
  const units = useUnits(id, filters);
  const [editing, setEditing] = useState(false);
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [unit, setUnit] = useState<Unit | 'new' | null>(null);
  const p = project.data;
  const buildingName = new Map((buildings.data ?? []).map((b) => [b.id, b.name]));
  const setFilter = (k: keyof UnitFilters, v: string) =>
    setFilters((f) => {
      const next = { ...f } as Record<string, unknown>;
      if (!v) delete next[k];
      else next[k] = k === 'bedrooms' ? Number(v) : v;
      return next as UnitFilters;
    });

  if (project.isLoading) return <Loading />;
  if (project.error || !p) return <Alert>{errorMessage(project.error)}</Alert>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/projects" className="text-muted-foreground hover:text-foreground" aria-label="Back to projects">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">{p.name}</h1>
        <Badge tone={p.isActive ? 'primary' : 'neutral'}>{p.isActive ? CONSTRUCTION_LABEL[p.constructionStatus] : 'Inactive'}</Badge>
        <span className="ml-auto" />
        {can('projects.manage') ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit project
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Available" value={p.inventory?.available ?? 0} />
        <StatCard label="On hold" value={p.inventory?.onHold ?? 0} />
        <StatCard label="Booked" value={p.inventory?.booked ?? 0} />
        <StatCard label="Sold" value={p.inventory?.sold ?? 0} />
      </div>

      <Card>
        <CardBody className="grid gap-2 text-sm sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">Developer:</span> {developers.data?.find((d) => d.id === p.developerId)?.name ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Location:</span> {[p.community, p.city].filter(Boolean).join(', ') || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Handover:</span> {p.handoverDate ? formatDate(p.handoverDate, 'UTC') : '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Payment plan:</span> {p.paymentPlan ?? '—'}
          </p>
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">Buildings:</span> {(buildings.data ?? []).map((b) => `${b.name}${b.floors ? ` (${b.floors} floors)` : ''}`).join(' · ') || '—'}{' '}
            {can('projects.manage') ? (
              <Button variant="link" size="sm" onClick={() => setAddingBuilding(true)}>
                <Plus /> Add building
              </Button>
            ) : null}
          </p>
          {p.description ? <p className="whitespace-pre-line text-muted-foreground sm:col-span-3">{p.description}</p> : null}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Units</h2>
        <Select className="h-8 w-auto text-xs" value={filters.buildingId ?? ''} onChange={(e) => setFilter('buildingId', e.target.value)} aria-label="Building">
          <option value="">All buildings</option>
          {buildings.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto text-xs" value={filters.propertyType ?? ''} onChange={(e) => setFilter('propertyType', e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(PROPERTY_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto text-xs" value={filters.bedrooms ?? ''} onChange={(e) => setFilter('bedrooms', e.target.value)} aria-label="Bedrooms">
          <option value="">Any bedrooms</option>
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Studio' : `${n} bed`}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto text-xs" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(UNIT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input className="h-8 w-28 text-xs" placeholder="Price from" value={filters.priceMin ?? ''} onChange={(e) => setFilter('priceMin', e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Price from" />
        <Input className="h-8 w-28 text-xs" placeholder="Price to" value={filters.priceMax ?? ''} onChange={(e) => setFilter('priceMax', e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Price to" />
        <span className="ml-auto" />
        {can('projects.manage') ? (
          <Button size="sm" onClick={() => setUnit('new')}>
            <Plus /> New unit
          </Button>
        ) : null}
      </div>
      {units.error ? <Alert>{errorMessage(units.error)}</Alert> : null}
      <Table>
        <thead>
          <tr>
            <Th>Unit</Th>
            <Th>Building</Th>
            <Th>Type</Th>
            <Th>Beds</Th>
            <Th>Size (sq ft)</Th>
            <Th>Floor</Th>
            <Th>View</Th>
            <Th>Price</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {(units.data?.data ?? []).map((u) => (
            <Tr key={u.id} className="cursor-pointer" onClick={() => setUnit(u)}>
              <Td className="font-medium">{u.unitNumber}</Td>
              <Td>{u.buildingId ? (buildingName.get(u.buildingId) ?? '—') : '—'}</Td>
              <Td>{PROPERTY_TYPE_LABEL[u.propertyType]}</Td>
              <Td>{u.bedrooms === 0 ? 'Studio' : u.bedrooms}</Td>
              <Td>{u.sizeSqft.toLocaleString('en-US')}</Td>
              <Td>{u.floor ?? '—'}</Td>
              <Td>{u.view ?? '—'}</Td>
              <Td className="whitespace-nowrap">{formatPrice(u.price, u.currency)}</Td>
              <Td>
                <Badge tone={UNIT_STATUS_TONE[u.status]}>{UNIT_STATUS_LABEL[u.status]}</Badge>
              </Td>
            </Tr>
          ))}
          {units.data?.data.length === 0 ? (
            <tr>
              <Td colSpan={9} className="text-center text-muted-foreground">
                No units match.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <ProjectDialog open={editing} project={p} onClose={() => setEditing(false)} />
      <BuildingDialog projectId={id} open={addingBuilding} onClose={() => setAddingBuilding(false)} />
      {unit ? <UnitDialog projectId={id} unit={unit === 'new' ? null : unit} buildings={buildings.data ?? []} onClose={() => setUnit(null)} /> : null}
    </div>
  );
}

function BuildingDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { createBuilding } = useProjectActions();
  const [name, setName] = useState('');
  const [floors, setFloors] = useState('');
  const [handover, setHandover] = useState('');
  const close = () => {
    setName('');
    setFloors('');
    setHandover('');
    createBuilding.reset();
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="Add building">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await createBuilding
              .mutateAsync({ projectId, name: name.trim(), ...(floors ? { floors: Number(floors) } : {}), ...(handover ? { handoverDate: handover } : {}) })
              .catch(() => null);
            if (ok) close();
          }}
        >
          <Field label="Name *" error={createBuilding.error instanceof ApiError ? createBuilding.error.fieldError('name') : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tower A" />
          </Field>
          <Field label="Floors">
            <Input type="number" min={1} value={floors} onChange={(e) => setFloors(e.target.value)} />
          </Field>
          <Field label="Handover date">
            <Input type="date" value={handover} onChange={(e) => setHandover(e.target.value)} />
          </Field>
          {createBuilding.error ? <Alert>{errorMessage(createBuilding.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createBuilding.isPending}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { LabelsService } from '../dashboard/labels.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DealsService } from '../deals/deals.service';
import { CommissionsService } from '../finance/commissions.service';
import { CounterpartiesService } from '../finance/counterparties.service';
import { DocumentsService } from '../finance/documents.service';
import { ProjectsService } from '../projects/projects.service';
import { UnitsService } from '../projects/units.service';
import type { ReportDefinition } from './report-definitions';

// Phase 3 reports (SRS §8.8, §9.5): sales by project and unit, invoices, payments, balances, commissions, attendance.

export interface Phase3Deps {
  deals: DealsService;
  documents: DocumentsService;
  commissions: CommissionsService;
  counterparties: CounterpartiesService;
  attendance: AttendanceService;
  projects: ProjectsService;
  units: UnitsService;
  labels: LabelsService;
}

const money = (n: number) => n.toFixed(2);
const inPeriod = (d: string | null, from?: string, to?: string) => !!d && (!from || d >= from) && (!to || d <= to);
const FINANCE = ['finance.create'];
const DOC_LABEL = { sales_invoice: 'Sales invoice', purchase_invoice: 'Purchase invoice', purchase_order: 'Purchase order' } as const;
const STATUS_LABEL: Record<string, string> = { approved: 'Approved', sent: 'Sent', partially_paid: 'Partially paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', refunded: 'Refunded' };

export function phase3Reports(d: Phase3Deps): ReportDefinition[] {
  return [
    {
      key: 'sales_by_project',
      name: 'Sales by project',
      module: 'sales',
      exportPermission: 'reports.export',
      filters: ['from', 'to', 'projectId', 'userId'],
      columns: [
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'eois', label: 'EOIs', type: 'number' },
        { key: 'bookings', label: 'Bookings', type: 'number' },
        { key: 'sold', label: 'Sold', type: 'number' },
        { key: 'salesValue', label: 'Sales value', type: 'money' },
        { key: 'cancelled', label: 'Cancelled', type: 'number' },
      ],
      paged: false,
      async run(p, f) {
        const deals = await d.deals.forReport(p, f);
        const byProject = new Map<string, { eois: number; bookings: number; sold: number; salesValue: number; cancelled: number }>();
        for (const deal of deals) {
          const row = byProject.get(deal.projectId) ?? { eois: 0, bookings: 0, sold: 0, salesValue: 0, cancelled: 0 };
          if (inPeriod(deal.eoiDate, f.from, f.to)) row.eois++;
          if (inPeriod(deal.bookingDate, f.from, f.to)) row.bookings++;
          if (deal.stage === 'sold' && inPeriod(deal.saleDate, f.from, f.to)) {
            row.sold++;
            row.salesValue += Number(deal.saleValue);
          }
          if (deal.stage === 'cancelled' && inPeriod(deal.updatedAt.toISOString().slice(0, 10), f.from, f.to)) row.cancelled++;
          byProject.set(deal.projectId, row);
        }
        const names = await d.projects.names([...byProject.keys()]);
        const rows = [...byProject.entries()]
          .map(([projectId, r]) => ({ projectId, project: names.get(projectId) ?? projectId, ...r, salesValue: money(r.salesValue) }))
          .filter((r) => r.eois || r.bookings || r.sold || r.cancelled)
          .sort((a, b) => Number(b.salesValue) - Number(a.salesValue));
        const sum = (k: 'eois' | 'bookings' | 'sold' | 'cancelled') => rows.reduce((n, r) => n + r[k], 0);
        return { rows, totals: { eois: sum('eois'), bookings: sum('bookings'), sold: sum('sold'), cancelled: sum('cancelled'), salesValue: money(rows.reduce((n, r) => n + Number(r.salesValue), 0)) } };
      },
    },
    {
      key: 'sales_by_unit',
      name: 'Sales by unit',
      module: 'sales',
      exportPermission: 'reports.export',
      filters: ['from', 'to', 'projectId', 'userId'],
      columns: [
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'unit', label: 'Unit', type: 'text' },
        { key: 'stage', label: 'Stage', type: 'text' },
        { key: 'agent', label: 'Agent', type: 'text' },
        { key: 'listPrice', label: 'List price', type: 'money' },
        { key: 'bookingDate', label: 'Booked', type: 'date' },
        { key: 'saleValue', label: 'Sale value', type: 'money' },
        { key: 'saleDate', label: 'Sold', type: 'date' },
      ],
      paged: false,
      async run(p, f) {
        const deals = (await d.deals.forReport(p, f)).filter(
          (x) => x.unitId && (x.stage === 'booking' || x.stage === 'sold') && (inPeriod(x.bookingDate, f.from, f.to) || inPeriod(x.saleDate, f.from, f.to)),
        );
        const [units, projects, agents] = await Promise.all([
          d.units.byIds(deals.map((x) => x.unitId!)),
          d.projects.names([...new Set(deals.map((x) => x.projectId))]),
          d.labels.users([...new Set(deals.map((x) => x.ownerUserId))]),
        ]);
        const rows = deals
          .map((x) => ({
            dealId: x.id,
            project: projects.get(x.projectId) ?? x.projectId,
            unit: units.get(x.unitId!)?.unitNumber ?? '—',
            stage: x.stage === 'sold' ? 'Sold' : 'Booked',
            agent: agents.get(x.ownerUserId) ?? '—',
            listPrice: units.get(x.unitId!) ? money(Number(units.get(x.unitId!)!.price)) : null,
            bookingDate: x.bookingDate,
            saleValue: x.saleValue === null ? null : money(Number(x.saleValue)),
            saleDate: x.saleDate,
          }))
          .sort((a, b) => a.project.localeCompare(b.project) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
        return { rows, totals: { units: rows.length, saleValue: money(rows.reduce((n, r) => n + Number(r.saleValue ?? 0), 0)) } };
      },
    },
    {
      key: 'invoices',
      name: 'Invoices and purchase orders',
      module: 'finance',
      permissions: FINANCE,
      exportPermission: 'reports.export',
      filters: ['from', 'to'],
      columns: [
        { key: 'number', label: 'Number', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'counterparty', label: 'With', type: 'text' },
        { key: 'issueDate', label: 'Issued', type: 'date' },
        { key: 'dueDate', label: 'Due', type: 'date' },
        { key: 'currency', label: 'Currency', type: 'text' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'paid', label: 'Paid', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'status', label: 'Status', type: 'text' },
      ],
      paged: false,
      async run(_p, f) {
        const docs = await d.documents.forReport(f.from, f.to);
        const names = await d.counterparties.names([...new Set(docs.map((x) => x.counterpartyId))]);
        const rows = docs.map((x) => ({
          documentId: x.id,
          number: x.number,
          type: DOC_LABEL[x.docType],
          counterparty: names.get(x.counterpartyId) ?? '—',
          issueDate: x.issueDate,
          dueDate: x.dueDate,
          currency: x.currency,
          total: money(Number(x.total)),
          paid: money(Number(x.amountPaid) - Number(x.amountRefunded)),
          balance: x.docType === 'purchase_order' || x.status === 'cancelled' ? '0.00' : money(Number(x.balance)),
          status: STATUS_LABEL[x.status] ?? x.status,
        }));
        const live = docs.filter((x) => x.status !== 'cancelled' && x.docType === 'sales_invoice');
        return {
          rows,
          totals: {
            documents: rows.length,
            salesInvoiced: money(live.reduce((n, x) => n + Number(x.total) * Number(x.rateToBase), 0)),
            salesOutstanding: money(live.reduce((n, x) => n + Number(x.balance) * Number(x.rateToBase), 0)),
          },
        };
      },
    },
    {
      key: 'payments',
      name: 'Payments and refunds',
      module: 'finance',
      permissions: FINANCE,
      exportPermission: 'reports.export',
      filters: ['from', 'to'],
      columns: [
        { key: 'paidOn', label: 'Date', type: 'date' },
        { key: 'number', label: 'Document', type: 'text' },
        { key: 'counterparty', label: 'With', type: 'text' },
        { key: 'kind', label: 'Kind', type: 'text' },
        { key: 'method', label: 'Method', type: 'text' },
        { key: 'reference', label: 'Reference', type: 'text' },
        { key: 'currency', label: 'Currency', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      paged: false,
      async run(_p, f) {
        const list = await d.documents.paymentsForReport(f.from, f.to);
        const names = await d.counterparties.names([...new Set(list.map((x) => x.counterpartyId))]);
        const rows = list.map((x) => ({
          paymentId: x.p.id,
          paidOn: x.p.paidOn,
          number: x.number,
          counterparty: names.get(x.counterpartyId) ?? '—',
          kind: x.p.kind === 'payment' ? (x.docType === 'sales_invoice' ? 'Received' : 'Paid out') : 'Refund',
          method: x.p.method.replace('_', ' '),
          reference: x.p.reference,
          currency: x.p.currency,
          amount: money(Number(x.p.amount) * (x.p.kind === 'refund' ? -1 : 1)),
        }));
        return { rows, totals: { payments: rows.length, net: money(rows.reduce((n, r) => n + Number(r.amount), 0)) } };
      },
    },
    {
      key: 'balances',
      name: 'Balances by client and developer',
      module: 'finance',
      permissions: FINANCE,
      exportPermission: 'reports.export',
      filters: ['from', 'to'],
      columns: [
        { key: 'counterparty', label: 'Client / developer', type: 'text' },
        { key: 'invoices', label: 'Invoices', type: 'number' },
        { key: 'invoiced', label: 'Invoiced', type: 'money' },
        { key: 'received', label: 'Received', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'overdue', label: 'Overdue', type: 'money' },
      ],
      paged: false,
      async run(_p, f) {
        const docs = (await d.documents.forReport(f.from, f.to)).filter((x) => x.docType === 'sales_invoice' && x.status !== 'cancelled');
        const by = new Map<string, { invoices: number; invoiced: number; received: number; balance: number; overdue: number }>();
        for (const x of docs) {
          const r = by.get(x.counterpartyId) ?? { invoices: 0, invoiced: 0, received: 0, balance: 0, overdue: 0 };
          const rate = Number(x.rateToBase);
          r.invoices++;
          r.invoiced += Number(x.total) * rate;
          r.received += (Number(x.amountPaid) - Number(x.amountRefunded)) * rate;
          r.balance += Number(x.balance) * rate;
          if (x.status === 'overdue') r.overdue += Number(x.balance) * rate;
          by.set(x.counterpartyId, r);
        }
        const names = await d.counterparties.names([...by.keys()]);
        const rows = [...by.entries()]
          .map(([id, r]) => ({ counterpartyId: id, counterparty: names.get(id) ?? '—', invoices: r.invoices, invoiced: money(r.invoiced), received: money(r.received), balance: money(r.balance), overdue: money(r.overdue) }))
          .sort((a, b) => Number(b.balance) - Number(a.balance));
        const sum = (k: 'invoiced' | 'received' | 'balance' | 'overdue') => money(rows.reduce((n, r) => n + Number(r[k]), 0));
        return { rows, totals: { invoices: rows.reduce((n, r) => n + r.invoices, 0), invoiced: sum('invoiced'), received: sum('received'), balance: sum('balance'), overdue: sum('overdue') } };
      },
    },
    {
      key: 'commissions',
      name: 'Agent commissions',
      module: 'finance',
      permissions: FINANCE,
      exportPermission: 'reports.export',
      filters: ['from', 'to', 'userId'],
      columns: [
        { key: 'agent', label: 'Agent', type: 'text' },
        { key: 'deals', label: 'Deals', type: 'number' },
        { key: 'pending', label: 'Pending', type: 'money' },
        { key: 'approved', label: 'Approved', type: 'money' },
        { key: 'paid', label: 'Paid', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' },
      ],
      paged: false,
      async run(_p, f) {
        const list = (await d.commissions.forReport()).filter(
          (c) => (!f.userId || c.userId === f.userId) && inPeriod(c.paidOn ?? c.createdAt.toISOString().slice(0, 10), f.from, f.to),
        );
        const by = new Map<string, { deals: Set<string>; pending: number; approved: number; paid: number }>();
        for (const c of list) {
          const r = by.get(c.userId) ?? { deals: new Set<string>(), pending: 0, approved: 0, paid: 0 };
          r.deals.add(c.dealId);
          r[c.status as 'pending' | 'approved' | 'paid'] += Number(c.amount);
          by.set(c.userId, r);
        }
        const names = await d.labels.users([...by.keys()]);
        const rows = [...by.entries()].map(([userId, r]) => ({
          userId,
          agent: names.get(userId) ?? '—',
          deals: r.deals.size,
          pending: money(r.pending),
          approved: money(r.approved),
          paid: money(r.paid),
          total: money(r.pending + r.approved + r.paid),
        }));
        const sum = (k: 'pending' | 'approved' | 'paid' | 'total') => money(rows.reduce((n, r) => n + Number(r[k]), 0));
        return { rows, totals: { pending: sum('pending'), approved: sum('approved'), paid: sum('paid'), total: sum('total') } };
      },
    },
    {
      key: 'attendance_monthly',
      name: 'Attendance by employee',
      module: 'attendance',
      permissions: ['attendance.view'],
      exportPermission: 'attendance.export',
      filters: ['from', 'to', 'teamId', 'userId'],
      columns: [
        { key: 'employee', label: 'Employee', type: 'text' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'halfDay', label: 'Half day', type: 'number' },
        { key: 'wfh', label: 'Work from home', type: 'number' },
        { key: 'leave', label: 'Leave', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'corrected', label: 'Corrected', type: 'number' },
      ],
      paged: false,
      async run(p, f) {
        const today = new Date().toISOString().slice(0, 10);
        const from = f.from ?? `${today.slice(0, 8)}01`;
        const to = f.to ?? today;
        const list = await d.attendance.summary(p, from, to, f.teamId, f.userId);
        const rows = list.map((s) => ({ userId: s.userId, employee: s.name, present: s.present, late: s.late, halfDay: s.half_day, wfh: s.wfh, leave: s.leave, absent: s.absent, corrected: s.corrected }));
        const sum = (k: 'present' | 'late' | 'halfDay' | 'wfh' | 'leave' | 'absent' | 'corrected') => rows.reduce((n, r) => n + r[k], 0);
        return { rows, totals: { present: sum('present'), late: sum('late'), halfDay: sum('halfDay'), wfh: sum('wfh'), leave: sum('leave'), absent: sum('absent'), corrected: sum('corrected') } };
      },
    },
  ];
}

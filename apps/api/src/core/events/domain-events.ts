import { Injectable, Logger } from '@nestjs/common';

/**
 * In-process domain events (architecture §3, "events bus"). Modules publish facts ("lead.created") and
 * other modules react, so no module reaches into another module's tables.
 *
 * Handlers run in order inside the publisher's tenant transaction: if a handler fails, the whole change
 * rolls back. Slow or external work (push, email, outside APIs) belongs in a queued job started by the handler.
 */
export interface DomainEvents {
  'lead.created': { tenantId: string; leadId: string; ownerUserId: string | null; sourceId: string; viaIntake: boolean };
  'lead.re_enquired': { tenantId: string; leadId: string; ownerUserId: string | null; sourceName: string; reopened: boolean };
  'lead.assigned': {
    tenantId: string;
    leadId: string;
    fromUserId: string | null;
    toUserId: string | null;
    method: 'manual' | 'round_robin' | 'rule' | 'no_response' | 'admin_fallback' | 'user_deactivated' | 're_enquiry';
  };
  'lead.needs_owner': { tenantId: string; leadId: string; excludeUserIds: string[]; method: 're_enquiry' | 'user_deactivated' };
  'lead.responded': { tenantId: string; leadId: string; userId: string };
  'lead.stage_changed': { tenantId: string; leadId: string; fromStageId: string | null; toStageId: string; category: string };
  'lead.shared': { tenantId: string; leadId: string; userId: string; access: 'view' | 'edit'; sharedBy: string };
  'lead.updated': { tenantId: string; leadId: string };
  'lead.no_response': { tenantId: string; leadId: string; userId: string };
  'lead.secondary_owner_changed': { tenantId: string; leadId: string; userId: string | null; changedBy: string };
  'user.receives_leads_changed': { tenantId: string; userId: string; receivesLeads: boolean };
}

export type DomainEventName = keyof DomainEvents;
type Handler<E extends DomainEventName> = (payload: DomainEvents[E]) => Promise<void> | void;

@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<DomainEventName, Handler<DomainEventName>[]>();

  /** Registers a handler; call from a module's onModuleInit. */
  on<E extends DomainEventName>(event: E, handler: Handler<E>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<DomainEventName>);
    this.handlers.set(event, list);
  }

  async publish<E extends DomainEventName>(event: E, payload: DomainEvents[E]): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        await handler(payload);
      } catch (err) {
        this.logger.error(`handler for ${event} failed: ${(err as Error).message}`);
        throw err;
      }
    }
  }
}

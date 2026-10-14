import { Logger } from '@nestjs/common';

/** One event changed in the agent's own calendar. */
export interface CalendarChange {
  /** Google Calendar event ID / Microsoft event ID (meetings.external_meeting_id). */
  externalMeetingId: string;
  /** Teams events are matched by their join link (the meeting stores the online-meeting ID). */
  joinUrl?: string;
  status: 'confirmed' | 'cancelled';
  startsAt?: Date;
  endsAt?: Date;
}

export interface CalendarAccount {
  provider: 'google_workspace' | 'microsoft_365';
  settings: Record<string, unknown>;
  credentials: Record<string, string>;
}

/**
 * Two-way calendar sync (SRS §3.13), one adapter per provider: after a push notification the changes since the
 * last sync are read with the provider's cursor (Google syncToken, Microsoft deltaLink). Locally
 * (CALENDAR_MODE=simulate) there is no outside calendar, so nothing changes.
 */
export interface CalendarSyncProvider {
  changes(account: CalendarAccount, cursor?: string): Promise<{ changes: CalendarChange[]; cursor?: string }>;
}
export const CALENDAR_SYNC = Symbol('CALENDAR_SYNC');

export class LiveCalendarSync implements CalendarSyncProvider {
  async changes(account: CalendarAccount, cursor?: string): Promise<{ changes: CalendarChange[]; cursor?: string }> {
    const token = account.credentials.accessToken;
    if (!token) throw new Error('The calendar access token is missing; connect the account again');
    return account.provider === 'google_workspace' ? this.google(token, cursor) : this.microsoft(token, cursor);
  }

  private async google(token: string, cursor?: string): Promise<{ changes: CalendarChange[]; cursor?: string }> {
    const changes: CalendarChange[] = [];
    let pageToken: string | undefined;
    let next: string | undefined;
    do {
      const q = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: '250' });
      if (cursor) q.set('syncToken', cursor);
      else q.set('updatedMin', new Date(Date.now() - 86_400_000).toISOString());
      if (pageToken) q.set('pageToken', pageToken);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { authorization: `Bearer ${token}` } });
      const json = (await res.json()) as {
        items?: { id: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[];
        nextPageToken?: string;
        nextSyncToken?: string;
        error?: { message?: string };
      };
      if (res.status === 410) return this.google(token); // sync token expired: start again
      if (!res.ok) throw new Error(`Google Calendar: ${json.error?.message ?? res.statusText}`);
      for (const e of json.items ?? []) {
        changes.push({
          externalMeetingId: e.id,
          status: e.status === 'cancelled' ? 'cancelled' : 'confirmed',
          ...(e.start?.dateTime ? { startsAt: new Date(e.start.dateTime) } : {}),
          ...(e.end?.dateTime ? { endsAt: new Date(e.end.dateTime) } : {}),
        });
      }
      pageToken = json.nextPageToken;
      next = json.nextSyncToken ?? next;
    } while (pageToken);
    return { changes, cursor: next ?? cursor };
  }

  private async microsoft(token: string, cursor?: string): Promise<{ changes: CalendarChange[]; cursor?: string }> {
    const changes: CalendarChange[] = [];
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 365 * 86_400_000).toISOString();
    let url: string | undefined = cursor ?? `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${start}&endDateTime=${end}`;
    let deltaLink: string | undefined;
    while (url) {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' } });
      const json = (await res.json()) as {
        value?: { id: string; '@removed'?: unknown; isCancelled?: boolean; start?: { dateTime?: string }; end?: { dateTime?: string }; onlineMeeting?: { joinUrl?: string } }[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(`Microsoft 365: ${json.error?.message ?? res.statusText}`);
      for (const e of json.value ?? []) {
        changes.push({
          externalMeetingId: e.id,
          ...(e.onlineMeeting?.joinUrl ? { joinUrl: e.onlineMeeting.joinUrl } : {}),
          status: e['@removed'] || e.isCancelled ? 'cancelled' : 'confirmed',
          ...(e.start?.dateTime ? { startsAt: new Date(`${e.start.dateTime}Z`) } : {}),
          ...(e.end?.dateTime ? { endsAt: new Date(`${e.end.dateTime}Z`) } : {}),
        });
      }
      url = json['@odata.nextLink'];
      deltaLink = json['@odata.deltaLink'] ?? deltaLink;
    }
    return { changes, cursor: deltaLink ?? cursor };
  }
}

export class SimulatedCalendarSync implements CalendarSyncProvider {
  private readonly logger = new Logger('CalendarSync');

  async changes(account: CalendarAccount, cursor?: string): Promise<{ changes: CalendarChange[]; cursor?: string }> {
    this.logger.log(`[simulated] ${account.provider} sync: no outside calendar`);
    return { changes: [], ...(cursor ? { cursor } : {}) };
  }
}

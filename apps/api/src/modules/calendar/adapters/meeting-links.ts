import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MeetingChannel } from '../calendar.schema';

export interface MeetingLinkRequest {
  channel: Extract<MeetingChannel, 'google_meet' | 'teams'>;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** The organizer's connected Google Workspace / Microsoft 365 account (calendar module 4), when there is one. */
  account?: { settings: Record<string, unknown>; credentials: Record<string, string> };
}

/**
 * Online meeting links (SRS §3.8): Google Meet through the agent's Google account, Teams through Microsoft 365,
 * at no extra cost. One adapter per provider; locally (CALENDAR_MODE=simulate) links are generated.
 */
export interface MeetingLinkProvider {
  create(request: MeetingLinkRequest): Promise<{ joinUrl: string; externalMeetingId: string }>;
}
export const MEETING_LINKS = Symbol('MEETING_LINKS');

/** Live: Google Calendar API (conferenceData → Meet) or Microsoft Graph (onlineMeetings → Teams). */
export class LiveMeetingLinks implements MeetingLinkProvider {
  async create(r: MeetingLinkRequest): Promise<{ joinUrl: string; externalMeetingId: string }> {
    const token = r.account?.credentials.accessToken;
    if (!token) throw new Error(`Connect your ${r.channel === 'google_meet' ? 'Google' : 'Microsoft 365'} account to create ${r.channel === 'google_meet' ? 'Google Meet' : 'Teams'} links`);
    if (r.channel === 'google_meet') {
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: r.title,
          start: { dateTime: r.startsAt.toISOString() },
          end: { dateTime: r.endsAt.toISOString() },
          conferenceData: { createRequest: { requestId: randomBytes(8).toString('hex'), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        }),
      });
      const json = (await res.json()) as { id?: string; hangoutLink?: string; error?: { message?: string } };
      if (!res.ok || !json.hangoutLink) throw new Error(`Google Calendar: ${json.error?.message ?? res.statusText}`);
      return { joinUrl: json.hangoutLink, externalMeetingId: json.id! };
    }
    const res = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ subject: r.title, startDateTime: r.startsAt.toISOString(), endDateTime: r.endsAt.toISOString() }),
    });
    const json = (await res.json()) as { id?: string; joinWebUrl?: string; error?: { message?: string } };
    if (!res.ok || !json.joinWebUrl) throw new Error(`Microsoft Teams: ${json.error?.message ?? res.statusText}`);
    return { joinUrl: json.joinWebUrl, externalMeetingId: json.id! };
  }
}

/** CALENDAR_MODE=simulate: a recognisable stand-in link, logged; nothing is sent to Google or Microsoft. */
export class SimulatedMeetingLinks implements MeetingLinkProvider {
  private readonly logger = new Logger('MeetingLinks');

  async create(r: MeetingLinkRequest): Promise<{ joinUrl: string; externalMeetingId: string }> {
    const code = randomBytes(6).toString('hex');
    const joinUrl = r.channel === 'google_meet' ? `https://meet.google.com/sim-${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}` : `https://teams.microsoft.com/l/meetup-join/sim-${code}`;
    this.logger.log(`[simulated ${r.channel}] ${r.title} ${r.startsAt.toISOString()} → ${joinUrl}`);
    return { joinUrl, externalMeetingId: `sim_${code}` };
  }
}

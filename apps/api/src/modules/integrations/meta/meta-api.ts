import { createHmac, timingSafeEqual } from 'node:crypto';

/** One lead form submission as Meta returns it (Graph API /{leadgen_id}). */
export interface MetaLead {
  id: string;
  createdTime: Date;
  fieldData: { name: string; values: string[] }[];
  formId?: string;
  formName?: string;
  adId?: string;
  adsetId?: string;
  campaignId?: string;
  campaignName?: string;
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
}

/** Adapter for Meta (architecture: one adapter per integration provider). Tests use a fake. */
export interface MetaApi {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  pages(userToken: string): Promise<MetaPage[]>;
  subscribePage(pageId: string, pageToken: string): Promise<void>;
  fetchLead(leadgenId: string, pageToken: string): Promise<MetaLead>;
  check(pageId: string, pageToken: string): Promise<{ ok: boolean; detail: string }>;
  /** IDs of every lead submitted on the page's forms in the period (Meta check, SRS §8.7). */
  listLeadIds(pageId: string, pageToken: string, from: Date, to: Date): Promise<string[]>;
}
export const META_API = Symbol('META_API');

const SCOPES = ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'ads_read'];

export class GraphMetaApi implements MetaApi {
  private readonly base: string;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    version: string,
  ) {
    this.base = `https://graph.facebook.com/${version}`;
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ client_id: this.appId, redirect_uri: redirectUri, state, scope: SCOPES.join(','), response_type: 'code' });
    return `https://www.facebook.com/${this.base.split('/').pop()}/dialog/oauth?${q}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const short = await this.get<{ access_token: string }>('/oauth/access_token', { client_id: this.appId, client_secret: this.appSecret, redirect_uri: redirectUri, code });
    // Long-lived user token, so the page tokens derived from it do not expire.
    const long = await this.get<{ access_token: string }>('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: short.access_token,
    });
    return long.access_token;
  }

  async pages(userToken: string): Promise<MetaPage[]> {
    const out = await this.get<{ data: { id: string; name: string; access_token: string }[] }>('/me/accounts', { access_token: userToken, fields: 'id,name,access_token' });
    return out.data.map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
  }

  async subscribePage(pageId: string, pageToken: string): Promise<void> {
    await this.post(`/${pageId}/subscribed_apps`, { subscribed_fields: 'leadgen', access_token: pageToken });
  }

  async fetchLead(leadgenId: string, pageToken: string): Promise<MetaLead> {
    const lead = await this.get<{
      id: string;
      created_time: string;
      field_data: { name: string; values: string[] }[];
      form_id?: string;
      ad_id?: string;
      adset_id?: string;
      campaign_id?: string;
      campaign_name?: string;
    }>(`/${leadgenId}`, { access_token: pageToken, fields: 'id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,campaign_name' });
    let formName: string | undefined;
    if (lead.form_id) {
      formName = await this.get<{ name?: string }>(`/${lead.form_id}`, { access_token: pageToken, fields: 'name' }).then((f) => f.name).catch(() => undefined);
    }
    return {
      id: lead.id,
      createdTime: new Date(lead.created_time),
      fieldData: lead.field_data,
      formId: lead.form_id,
      formName,
      adId: lead.ad_id,
      adsetId: lead.adset_id,
      campaignId: lead.campaign_id,
      campaignName: lead.campaign_name,
    };
  }

  async check(pageId: string, pageToken: string) {
    try {
      const page = await this.get<{ name: string }>(`/${pageId}`, { access_token: pageToken, fields: 'name' });
      return { ok: true, detail: `Connected to page ${page.name}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async listLeadIds(pageId: string, pageToken: string, from: Date, to: Date): Promise<string[]> {
    const forms = await this.all<{ id: string }>(`/${pageId}/leadgen_forms`, { access_token: pageToken, fields: 'id', limit: '100' });
    const filtering = JSON.stringify([
      { field: 'time_created', operator: 'GREATER_THAN_OR_EQUAL', value: Math.floor(from.getTime() / 1000) },
      { field: 'time_created', operator: 'LESS_THAN', value: Math.floor(to.getTime() / 1000) },
    ]);
    const ids: string[] = [];
    for (const form of forms) {
      const leads = await this.all<{ id: string }>(`/${form.id}/leads`, { access_token: pageToken, fields: 'id', filtering, limit: '500' });
      ids.push(...leads.map((l) => l.id));
    }
    return ids;
  }

  /** Follows Graph API paging (paging.cursors.after) to the end. */
  private async all<T>(path: string, query: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    do {
      const page = await this.get<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, { ...query, ...(after ? { after } : {}) });
      out.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
    } while (after);
    return out;
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.base}${path}?${new URLSearchParams(this.withProof(query))}`);
    return this.parse<T>(res);
  }

  private async post<T>(path: string, body: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { method: 'POST', body: new URLSearchParams(this.withProof(body)) });
    return this.parse<T>(res);
  }

  /** appsecret_proof: proves calls with a token come from our server. */
  private withProof(params: Record<string, string>): Record<string, string> {
    if (!params.access_token) return params;
    return { ...params, appsecret_proof: createHmac('sha256', this.appSecret).update(params.access_token).digest('hex') };
  }

  private async parse<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok || body.error) throw new Error(`Meta API ${res.status}: ${body.error?.message ?? 'request failed'}`);
    return body;
  }
}

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the raw body with the app secret. */
export function validMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string | undefined): boolean {
  if (!rawBody || !header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice('sha256='.length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

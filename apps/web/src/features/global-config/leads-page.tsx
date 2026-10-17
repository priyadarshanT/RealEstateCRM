'use client';

import { Loading } from '@crm/ui';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/core/api';
import { useCan } from '@/core/session';
import { AssignmentTab } from './assignment-tab';
import { LeadRules } from './lead-rules';
import { ReasonsCard } from './sources-reasons';
import { ConfigShell, HistoryButton, Section, SwitchRow, useSettingDraft } from './ui';

type Features = {
  export_leads: boolean;
  source_update: boolean;
  dual_ownership: boolean;
  secondary_owner_notification: boolean;
  past_date_selection: boolean;
  hide_contact_info: { enabled: boolean; role_keys: string[] };
  mandatory_location: boolean;
  unassigned_communication: boolean;
  rotation: boolean;
};

/**
 * Global Configuration › Leads (§6): lead feature switches (enforced by the API), then the lead rules that were on
 * the old settings page: rotation rules (which replaced assignment rules and the 10-minute rule), scoring weights and
 * reassignment reasons.
 */
export function LeadsPage() {
  const s = useSettingDraft<Features>('leads.features');
  const can = useCan();
  // Role names for Hide Lead Contact Info; only users who manage roles can list them.
  const roles = useQuery({ queryKey: ['roles'], queryFn: async () => unwrap(await api.GET('/roles')).data, enabled: can('users.manage') });
  const d = s.draft;

  return (
    <ConfigShell
      title="Leads"
      description="Configure lead features"
      dirty={s.dirty}
      saving={s.saving}
      saved={s.saved}
      error={s.error ?? s.loadError}
      onSave={s.save}
      onCancel={s.cancel}
      actions={<HistoryButton settingKey="leads.features" />}
    >
      {!d ? (
        <Loading />
      ) : (
        <Section title="Lead features" description="Each switch is checked by the server as well, so it cannot be bypassed.">
          <SwitchRow
            title="Export Leads"
            description="Allow users with the export permission to download lead lists. When off, lead exports are blocked."
            checked={d.export_leads}
            onChange={(v) => s.set({ export_leads: v })}
          />
          <SwitchRow
            title="Lead Source Update"
            description="Allow changing a lead's source. The original source stays on the first enquiry and in the history."
            checked={d.source_update}
            onChange={(v) => s.set({ source_update: v })}
          />
          <SwitchRow
            title="Dual Lead Ownership"
            description="A lead can have a primary and a secondary owner (never the same person)."
            checked={d.dual_ownership}
            onChange={(v) => s.set({ dual_ownership: v, ...(v ? {} : { secondary_owner_notification: false }) })}
            note="Set the secondary owner on the lead page. They see and edit the lead like a share with Can edit."
          >
            <SwitchRow
              title="Enable Secondary Owner Notification"
              description="Notify the secondary owner of new activity on their leads."
              checked={d.secondary_owner_notification}
              onChange={(v) => s.set({ secondary_owner_notification: v })}
            />
          </SwitchRow>
          <SwitchRow
            title="Enable Past Date Selection"
            description="Allow follow-up and scheduling dates in the past (company time zone). When off, past dates are refused."
            checked={d.past_date_selection}
            onChange={(v) => s.set({ past_date_selection: v })}
          />
          <SwitchRow
            title="Hide Lead Contact Info"
            description="Mask phone numbers and email addresses for the chosen roles in lists, lead pages, search and exports."
            checked={d.hide_contact_info.enabled}
            onChange={(v) => s.set({ hide_contact_info: { ...d.hide_contact_info, enabled: v } })}
          >
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">Hide from these roles *</legend>
              {roles.isLoading ? <Loading /> : null}
              <div className="flex flex-wrap gap-2">
                {(roles.data ?? []).map((r) => {
                  const on = d.hide_contact_info.role_keys.includes(r.key);
                  return (
                    <label key={r.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={(e) =>
                          s.set({
                            hide_contact_info: {
                              ...d.hide_contact_info,
                              role_keys: e.target.checked ? [...d.hide_contact_info.role_keys, r.key] : d.hide_contact_info.role_keys.filter((k) => k !== r.key),
                            },
                          })
                        }
                      />
                      {r.name}
                    </label>
                  );
                })}
              </div>
              {s.fieldError('hide_contact_info.role_keys') ? <p className="mt-1 text-xs text-danger">{s.fieldError('hide_contact_info.role_keys')}</p> : null}
            </fieldset>
          </SwitchRow>
          <SwitchRow
            title="Mandatory Location"
            description="A country is required when a lead is added by hand."
            checked={d.mandatory_location}
            onChange={(v) => s.set({ mandatory_location: v })}
          />
          <SwitchRow
            title="Communication on Unassigned Leads"
            description="Allow WhatsApp and email to leads that have no owner yet. When off, assign the lead first."
            checked={d.unassigned_communication}
            onChange={(v) => s.set({ unassigned_communication: v })}
          />
          <SwitchRow
            title="Rotation"
            description="New leads go to agents by the rotation rules below; a lead nobody answers in time rotates to the next agent, then to the fallback. When off, new leads wait in Unassigned."
            checked={d.rotation}
            onChange={(v) => s.set({ rotation: v })}
          />
        </Section>
      )}

      <Section
        title="Rotation rules"
        description="Each rule: which leads, which team or agents, its shift, minutes before an unanswered lead rotates, how many rotations, then the fallback. Rules are tried top to bottom; leads that match none go to Unassigned. These save on their own."
      >
        <AssignmentTab />
      </Section>
      <Section title="Lead score" description="Saves on its own with its Save button.">
        <LeadRules />
      </Section>
      <ReasonsCard />
    </ConfigShell>
  );
}

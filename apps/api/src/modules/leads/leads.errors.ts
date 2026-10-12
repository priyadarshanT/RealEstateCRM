import { ProblemException } from '../../core/errors/problem';

// Business error codes from docs/05-API-Guide.md §6.
export const LeadErrors = {
  exists: (lead: { leadId: string; ownerUserId: string | null; ownerName: string | null; stageName: string }) =>
    new ProblemException(
      409,
      'LEAD_EXISTS',
      'Lead already exists',
      lead.ownerName ? `This lead already exists, owned by ${lead.ownerName}.` : 'This lead already exists (unassigned).',
      undefined,
      { lead },
    ),
  reasonRequired: (detail: string) => new ProblemException(422, 'REASON_REQUIRED', 'Reason required', detail),
  nextActionRequired: () =>
    new ProblemException(422, 'NEXT_ACTION_REQUIRED', 'Next follow-up required', 'An open lead with an owner needs a next follow-up date.'),
  notReceivingLeads: () =>
    new ProblemException(422, 'USER_NOT_RECEIVING_LEADS', 'User is not receiving leads', 'Lead assignment is switched off for this user.'),
  invalidState: (detail: string) => new ProblemException(422, 'INVALID_STATE', 'Not allowed in the current state', detail),
  versionConflict: () =>
    new ProblemException(409, 'VERSION_CONFLICT', 'Changed by someone else', 'Someone else saved this lead first. Reload and try again.'),
  contactRequired: () =>
    new ProblemException(400, 'VALIDATION_FAILED', 'Invalid input', undefined, [{ field: 'phonePrimary', message: 'a phone or an email is required' }]),
};

import {
  Building2,
  Clock,
  Code2,
  Database,
  FileUp,
  ListChecks,
  MapPin,
  Megaphone,
  Phone,
  QrCode,
  Radio,
  Settings2,
  ShieldCheck,
  Tags,
  UserRound,
  Workflow,
  LayoutList,
  Mail,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

// What the Global Configuration page shows (stakeholder document "Settings and Integrations", 2026-10-17).
// A card with no `href` has no agreed scope yet: it is shown, clearly marked, never as a finished feature (§1.24).

export interface ModuleCard {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Icon circle colours. */
  tone: string;
  href?: string;
}

export const MODULES: ModuleCard[] = [
  { key: 'general', title: 'General', description: 'Common platform configuration', icon: Settings2, tone: 'bg-sky-100 text-sky-700', href: '/configuration/general' },
  { key: 'security', title: 'Security', description: 'Authentication and data protection', icon: ShieldCheck, tone: 'bg-rose-100 text-rose-700', href: '/configuration/security' },
  { key: 'attendance', title: 'Attendance', description: 'Manage shift timings', icon: Clock, tone: 'bg-amber-100 text-amber-700', href: '/attendance?tab=setup' },
  { key: 'leads', title: 'Leads', description: 'Configure lead features', icon: UserRound, tone: 'bg-teal-100 text-teal-700', href: '/configuration/leads' },
  { key: 'data', title: 'Data', description: 'Configure data fields', icon: Database, tone: 'bg-slate-100 text-slate-700' },
  { key: 'projects', title: 'Projects and Properties', description: 'Project and property settings', icon: Building2, tone: 'bg-indigo-100 text-indigo-700' },
  { key: 'locality', title: 'Locality', description: 'Manage locations and localities', icon: MapPin, tone: 'bg-emerald-100 text-emerald-700' },
  { key: 'qr', title: 'QR Code', description: 'Customize the QR enquiry form', icon: QrCode, tone: 'bg-violet-100 text-violet-700' },
  { key: 'tags', title: 'Tags', description: 'Manage tags', icon: Tags, tone: 'bg-orange-100 text-orange-700' },
  { key: 'marketing', title: 'Manage Marketing', description: 'Campaigns, ad spend and events', icon: Megaphone, tone: 'bg-pink-100 text-pink-700', href: '/configuration/marketing' },
  { key: 'migration', title: 'Migration', description: 'Import previous CRM leads and data', icon: FileUp, tone: 'bg-cyan-100 text-cyan-700', href: '/configuration/migration' },
  { key: 'status', title: 'Manage Status', description: 'Configure lead statuses and substatuses', icon: ListChecks, tone: 'bg-red-100 text-red-700', href: '/configuration/status' },
  { key: 'listing', title: 'Listing Management', description: 'Manage property listings', icon: LayoutList, tone: 'bg-lime-100 text-lime-700' },
  { key: 'automation', title: 'Automation', description: 'Automatic actions and workflows', icon: Workflow, tone: 'bg-fuchsia-100 text-fuchsia-700' },
  { key: 'sources', title: 'Manage Source', description: 'Manage lead sources', icon: Radio, tone: 'bg-yellow-100 text-yellow-700', href: '/configuration/sources' },
  { key: 'dev', title: 'Dev Resources', description: 'API credentials and developer tools', icon: Code2, tone: 'bg-gray-100 text-gray-700' },
];

export type ConnectKind = 'webhook' | 'website' | 'portal' | 'whatsapp' | 'meta' | 'email';

export interface IntegrationCard {
  key: string;
  name: string;
  description: string;
  tab: 'third_party' | 'social' | 'others';
  /** Initials shown in the logo circle and its colours. */
  mark: string;
  tone: string;
  /** Existing integration providers shown on this card. */
  providers: string[];
  /** How it is connected today; none = not available yet. */
  connect?: ConnectKind;
}

export const INTEGRATION_TABS = [
  { key: 'third_party', label: '3rd Parties' },
  { key: 'social', label: 'Social Platforms' },
  { key: 'others', label: 'Others' },
] as const;

export const INTEGRATIONS: IntegrationCard[] = [
  { key: 'webhook', name: 'Webhook', description: 'Receive leads from any system with a secure link', tab: 'third_party', mark: 'WH', tone: 'bg-slate-800 text-white', providers: ['webhook'], connect: 'webhook' },
  { key: 'skyloov', name: 'Skyloov', description: 'Property portal leads', tab: 'third_party', mark: 'SK', tone: 'bg-blue-600 text-white', providers: [] },
  { key: 'dubizzle', name: 'Dubizzle', description: 'Property portal leads', tab: 'third_party', mark: 'DZ', tone: 'bg-red-600 text-white', providers: ['dubizzle'], connect: 'portal' },
  { key: 'bayut', name: 'Bayut', description: 'Property portal leads', tab: 'third_party', mark: 'BY', tone: 'bg-emerald-600 text-white', providers: ['bayut'], connect: 'portal' },
  { key: 'property_finder', name: 'Property Finder', description: 'Property portal leads', tab: 'third_party', mark: 'PF', tone: 'bg-rose-600 text-white', providers: ['property_finder'], connect: 'portal' },
  { key: 'whatsapp', name: 'WhatsApp', description: 'WhatsApp Business number (Meta Cloud API)', tab: 'social', mark: 'WA', tone: 'bg-green-500 text-white', providers: ['whatsapp_cloud'], connect: 'whatsapp' },
  { key: 'facebook', name: 'Facebook', description: 'Meta lead ads (Facebook and Instagram)', tab: 'social', mark: 'f', tone: 'bg-blue-700 text-white', providers: ['meta'], connect: 'meta' },
  { key: 'gmail', name: 'Gmail', description: 'Send and receive email with Gmail', tab: 'others', mark: 'GM', tone: 'bg-red-500 text-white', providers: ['gmail'] },
  { key: 'google_ads_landing', name: 'Google Ads Landing Page', description: 'Leads from your landing page form', tab: 'others', mark: 'LP', tone: 'bg-amber-500 text-white', providers: ['website'], connect: 'website' },
  { key: 'google_ads_form', name: 'Google Ads Lead Form', description: 'Leads from Google Ads lead form extensions', tab: 'others', mark: 'GA', tone: 'bg-yellow-500 text-white', providers: ['google_ads'] },
  { key: 'google_campaign', name: 'Google Campaign', description: 'Campaign results and spend from Google Ads', tab: 'others', mark: 'GC', tone: 'bg-sky-500 text-white', providers: [] },
  { key: 'microsoft_ads', name: 'Microsoft Ads', description: 'Leads and spend from Microsoft Advertising', tab: 'others', mark: 'MS', tone: 'bg-cyan-600 text-white', providers: [] },
];

export interface CommunicationCard {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  href?: string;
}

export const COMMUNICATION: CommunicationCard[] = [
  { key: 'templates', title: 'Templates', description: 'Email, WhatsApp and SMS templates with variables and approval status', icon: MessageSquareText, tone: 'bg-teal-100 text-teal-700', href: '/configuration/templates' },
  { key: 'ivr', title: 'IVR', description: 'Phone number, greeting, menu, routing and working hours', icon: Phone, tone: 'bg-violet-100 text-violet-700' },
  { key: 'email', title: 'Email Configuration', description: 'Sender, provider, reply-to address, signature and test email', icon: Mail, tone: 'bg-sky-100 text-sky-700', href: '/configuration/email' },
];

export const HUB_TABS = [
  { key: 'modules', label: 'Module Settings' },
  { key: 'integrations', label: 'Integration' },
  { key: 'communication', label: 'Communication' },
] as const;


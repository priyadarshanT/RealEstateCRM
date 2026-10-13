import { LeadPageScreen } from '@/features/leads/lead-page-screen';

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadPageScreen id={id} />;
}

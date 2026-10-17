import { ConfigSection } from '@/features/global-config/config-section';

export default async function ConfigurationSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <ConfigSection section={section} />;
}

import { ProjectDetailScreen } from '@/features/projects/project-detail-screen';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDetailScreen id={id} />;
}

import { Suspense } from 'react';
import { LeadsListScreen } from '@/features/leads/leads-list-screen';

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsListScreen />
    </Suspense>
  );
}

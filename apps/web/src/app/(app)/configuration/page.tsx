import { Suspense } from 'react';
import { ConfigHub } from '@/features/global-config/config-hub';

export default function ConfigurationPage() {
  return (
    <Suspense>
      <ConfigHub />
    </Suspense>
  );
}

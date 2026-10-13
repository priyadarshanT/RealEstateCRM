import { Suspense } from 'react';
import { SettingsScreen } from '@/features/settings/settings-screen';

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}

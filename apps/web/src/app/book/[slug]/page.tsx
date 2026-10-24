import { turnstileSiteKey } from '@/core/config';
import { PublicBookingScreen } from '@/features/calendar/public-booking-screen';

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicBookingScreen slug={slug} turnstileSiteKey={turnstileSiteKey()} />;
}

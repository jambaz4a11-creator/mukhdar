import type { Metadata } from 'next';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';

export const metadata: Metadata = { title: 'صار خلل' };

// الـ proxy يعيد كتابة أي مسار محمي لهنا (503) حين يتعذّر التحقق من الجلسة بسبب خلل خادم/شبكة.
export default function UnavailablePage() {
  return <ServiceUnavailable />;
}

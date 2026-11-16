// قائمة السائقين بنافذة التعيين (مراجعة جلسة C، M1): السائق المعطّل والسائق الحالي لا يظهران، والسائق الذي
// لم يغيّر رمزه المؤقت يظهر معطّلاً بملاحظة (قاعدة البيانات ترفضه DRIVER_PIN_PENDING).
import type { Driver } from './api';

export interface DriverOption {
  id: string;
  label: string;
  disabled: boolean;
}

export const DRIVER_PIN_PENDING_LABEL = 'لم يغيّر رمزه بعد';

export function driverOptions(drivers: Driver[], currentDriverId: string | null): DriverOption[] {
  return drivers
    .filter((d) => d.is_active && d.id !== currentDriverId)
    .map((d) => ({
      id: d.id,
      label: d.must_change_pin ? `${d.full_name} (${DRIVER_PIN_PENDING_LABEL})` : d.full_name,
      disabled: d.must_change_pin,
    }));
}

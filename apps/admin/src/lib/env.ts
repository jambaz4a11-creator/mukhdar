// إعداد Supabase العام للوحة. مفتاح anon/publishable فقط: مفتاح خادم يوقف اللوحة (SPEC-admin: لا service_role بالمتصفح).
import { isServerKey } from '@mukhdar/shared';

export interface PublicEnv {
  url: string;
  key: string;
}

export function readPublicEnv(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
): PublicEnv {
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required (apps/admin/.env.local)',
    );
  }
  if (isServerKey(key)) {
    throw new Error(
      'Refusing a server key (service_role / sb_secret_) in the admin panel: use the publishable key',
    );
  }
  return { url, key };
}

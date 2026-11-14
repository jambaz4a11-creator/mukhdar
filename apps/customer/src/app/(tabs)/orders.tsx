// طلباتي: محمية (T10). القائمة نفسها بـ T14.
import { AppText } from '../../components/AppText';
import { Placeholder } from '../../components/Screen';
import { useRequireAuth } from '../../features/auth/useRequireAuth';
import { ar } from '../../i18n/ar';

export default function OrdersScreen() {
  const session = useRequireAuth();
  if (!session) return null;
  return (
    <Placeholder>
      <AppText weight="semibold" size="title">
        {ar.placeholders.orders}
      </AppText>
      <AppText muted>{ar.placeholders.soon}</AppText>
    </Placeholder>
  );
}

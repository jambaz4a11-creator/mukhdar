import { AppText } from '../../components/AppText';
import { Placeholder } from '../../components/Screen';
import { ar } from '../../i18n/ar';

export default function CartScreen() {
  return (
    <Placeholder>
      <AppText weight="semibold" size="title">
        {ar.placeholders.cart}
      </AppText>
      <AppText muted>{ar.placeholders.soon}</AppText>
    </Placeholder>
  );
}
